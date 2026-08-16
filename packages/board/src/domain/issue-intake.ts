import { and, eq } from "drizzle-orm";
import {
  githubIssueIntakes,
  projects,
  threads,
} from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { createThread } from "./threads.js";
import { recordEvent } from "./events.js";
import { getParticipant } from "./helpers.js";
import type { GitHubClient } from "../github/types.js";

function buildRedirectBody(publicBaseUrl: string, threadId: string) {
  return `議論の正本は Comitia ボードです。この Issue は案内のためクローズします。

スレッド: ${publicBaseUrl}/threads/${threadId}

続きはボードでお願いします。GitHub 側では議論しないでください。`;
}

export async function intakeOpenedIssue(
  db: Db,
  github: GitHubClient,
  input: {
    projectId: string;
    issueNumber: number;
    title: string;
    htmlUrl: string;
    isPullRequest: boolean;
    publicBaseUrl: string;
  },
) {
  if (input.isPullRequest) {
    return null;
  }

  const [existingIntake] = await db
    .select()
    .from(githubIssueIntakes)
    .where(
      and(
        eq(githubIssueIntakes.projectId, input.projectId),
        eq(githubIssueIntakes.issueNumber, input.issueNumber),
      ),
    )
    .limit(1);
  if (existingIntake) {
    return { threadId: existingIntake.boardThreadId, skipped: true as const };
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project?.githubInstallationId || !project.githubOwner || !project.githubRepo) {
    return null;
  }

  const trimmedTitle = input.title.trim().slice(0, 200);
  const trigger = `GitHub Issue #${input.issueNumber}: ${trimmedTitle}\n${input.htmlUrl}`;

  const [existingThread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.projectId, input.projectId),
        eq(threads.duplicateSearchQuery, input.htmlUrl),
      ),
    )
    .limit(1);

  let threadId = existingThread?.id;
  if (!threadId) {
    const owner = await getParticipant(db, project.ownerParticipantId);
    const thread = await createThread(db, {
      projectId: input.projectId,
      ownerId: owner.id,
      type: "consultation",
      title: trimmedTitle || `GitHub Issue #${input.issueNumber}`,
      trigger,
      duplicateSearchQuery: input.htmlUrl,
      conflictCitationsChecked: true,
    });
    threadId = thread.id;
  }

  const body = buildRedirectBody(input.publicBaseUrl, threadId);
  await github.commentAndCloseIssue({
    installationId: project.githubInstallationId,
    owner: project.githubOwner,
    repo: project.githubRepo,
    number: input.issueNumber,
    body,
  });

  await db.insert(githubIssueIntakes).values({
    projectId: input.projectId,
    issueNumber: input.issueNumber,
    boardThreadId: threadId,
    status: "redirected",
  });

  await recordEvent(db, {
    projectId: input.projectId,
    threadId,
    kind: "github_issue_redirected",
    payload: {
      issueNumber: input.issueNumber,
      htmlUrl: input.htmlUrl,
    },
  });

  return { threadId, skipped: false as const };
}
