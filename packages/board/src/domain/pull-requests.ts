import type { PullRequestState } from "@comitia/shared";
import { and, eq, inArray, lt, or, isNull } from "drizzle-orm";
import { projects, threadPullRequests, threads } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation } from "./errors.js";
import { getThreadRow } from "./helpers.js";
import type { GitHubClient } from "../github/types.js";
import { parsePullRequestUrl } from "../github/parse-pr-url.js";

export async function listThreadPullRequests(db: Db, threadId: string) {
  const rows = await db
    .select({
      number: threadPullRequests.number,
      url: threadPullRequests.url,
      title: threadPullRequests.title,
      state: threadPullRequests.state,
    })
    .from(threadPullRequests)
    .where(eq(threadPullRequests.threadId, threadId))
    .orderBy(threadPullRequests.number);
  return rows.map((row) => ({
    ...row,
    state: row.state as PullRequestState,
  }));
}

export async function linkPullRequest(
  db: Db,
  github: GitHubClient,
  input: { threadId: string; actorId: string; url: string },
) {
  const thread = await getThreadRow(db, input.threadId);
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, thread.projectId))
    .limit(1);
  if (!project) {
    throw new GateViolation("プロジェクトが見つかりません");
  }
  if (!project.githubInstallationId) {
    throw new GateViolation("GitHub App が接続されていません");
  }
  if (!project.githubOwner || !project.githubRepo) {
    throw new GateViolation("GitHub リポジトリが設定されていません");
  }

  const parsed = parsePullRequestUrl(input.url);
  if (
    parsed.owner !== project.githubOwner ||
    parsed.repo !== project.githubRepo
  ) {
    throw new GateViolation("PR のリポジトリがプロジェクトと一致しません");
  }

  const [existing] = await db
    .select()
    .from(threadPullRequests)
    .where(
      and(
        eq(threadPullRequests.projectId, project.id),
        eq(threadPullRequests.number, parsed.number),
      ),
    )
    .limit(1);
  if (existing && existing.threadId !== thread.id) {
    throw new GateViolation("この PR は別のスレッドにリンク済みです");
  }
  if (existing) {
    return existing;
  }

  const snapshot = await github.getPullRequest({
    installationId: project.githubInstallationId,
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
  });

  const now = new Date();
  const [row] = await db
    .insert(threadPullRequests)
    .values({
      threadId: thread.id,
      projectId: project.id,
      number: parsed.number,
      url: snapshot.url,
      title: snapshot.title,
      state: snapshot.state,
      syncedAt: now,
    })
    .returning();

  await recordEvent(db, {
    projectId: project.id,
    threadId: thread.id,
    actorParticipantId: input.actorId,
    kind: "pull_request_linked",
    payload: {
      number: parsed.number,
      url: snapshot.url,
      title: snapshot.title,
      state: snapshot.state,
    },
  });

  return row!;
}

export async function syncPullRequest(
  db: Db,
  github: GitHubClient,
  input: { projectId: string; number: number },
) {
  const [row] = await db
    .select()
    .from(threadPullRequests)
    .where(
      and(
        eq(threadPullRequests.projectId, input.projectId),
        eq(threadPullRequests.number, input.number),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project?.githubInstallationId || !project.githubOwner || !project.githubRepo) {
    return null;
  }

  const snapshot = await github.getPullRequest({
    installationId: project.githubInstallationId,
    owner: project.githubOwner,
    repo: project.githubRepo,
    number: input.number,
  });

  const now = new Date();
  const [updated] = await db
    .update(threadPullRequests)
    .set({
      title: snapshot.title,
      state: snapshot.state,
      syncedAt: now,
    })
    .where(eq(threadPullRequests.id, row.id))
    .returning();

  await recordEvent(db, {
    projectId: input.projectId,
    threadId: row.threadId,
    kind: "pull_request_synced",
    payload: {
      number: input.number,
      state: snapshot.state,
      title: snapshot.title,
    },
  });

  return updated!;
}

export async function refreshStalePullRequests(
  db: Db,
  github: GitHubClient,
  input: { projectId: string; maxAgeMs: number },
) {
  const cutoff = new Date(Date.now() - input.maxAgeMs);
  const stale = await db
    .select({ number: threadPullRequests.number })
    .from(threadPullRequests)
    .where(
      and(
        eq(threadPullRequests.projectId, input.projectId),
        or(
          isNull(threadPullRequests.syncedAt),
          lt(threadPullRequests.syncedAt, cutoff),
        ),
      ),
    );

  for (const row of stale) {
    try {
      await syncPullRequest(db, github, {
        projectId: input.projectId,
        number: row.number,
      });
    } catch {
      // Keep stale state on per-PR failure.
    }
  }
}

export async function listProjectPullRequestsForThreads(
  db: Db,
  threadIds: string[],
) {
  if (threadIds.length === 0) {
    return new Map<string, Awaited<ReturnType<typeof listThreadPullRequests>>>();
  }
  const rows = await db
    .select({
      threadId: threadPullRequests.threadId,
      number: threadPullRequests.number,
      url: threadPullRequests.url,
      title: threadPullRequests.title,
      state: threadPullRequests.state,
    })
    .from(threadPullRequests)
    .where(inArray(threadPullRequests.threadId, threadIds))
    .orderBy(threadPullRequests.number);

  const byThread = new Map<
    string,
    Array<{
      number: number;
      url: string;
      title: string;
      state: PullRequestState;
    }>
  >();
  for (const row of rows) {
    const list = byThread.get(row.threadId) ?? [];
    list.push({
      number: row.number,
      url: row.url,
      title: row.title,
      state: row.state as PullRequestState,
    });
    byThread.set(row.threadId, list);
  }
  return byThread;
}
