import "../test/helpers.js";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events, githubIssueIntakes, projects, threads } from "../db/schema.js";
import { db } from "../test/helpers.js";
import { seedOwnerAgentProject } from "../test/human-fixtures.js";
import { intakeOpenedIssue } from "./issue-intake.js";
import { createFakeGitHubClient } from "../github/fake-client.js";

const PUBLIC_URL = "https://board.example.com";
const ISSUE_URL = "https://github.com/hskksk/comitia/issues/42";

async function connectProject(projectId: string) {
  await db
    .update(projects)
    .set({
      githubInstallationId: "inst-1",
      githubOwner: "hskksk",
      githubRepo: "comitia",
    })
    .where(eq(projects.id, projectId));
}

describe("intakeOpenedIssue", () => {
  it("creates consultation thread, comments, closes, and records intake", async () => {
    const { project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const github = createFakeGitHubClient();

    const result = await intakeOpenedIssue(db, github, {
      projectId: project.id,
      issueNumber: 42,
      title: "質問があります",
      htmlUrl: ISSUE_URL,
      isPullRequest: false,
      publicBaseUrl: PUBLIC_URL,
    });

    expect(result?.skipped).toBe(false);
    expect(github.issueActions).toHaveLength(1);
    expect(github.issueActions[0]?.body).toContain(`${PUBLIC_URL}/threads/`);
    expect(github.issueActions[0]?.closed).toBe(true);

    const [thread] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, result!.threadId));
    expect(thread?.type).toBe("consultation");
    expect(thread?.duplicateSearchQuery).toBe(ISSUE_URL);

    const [intake] = await db
      .select()
      .from(githubIssueIntakes)
      .where(
        and(
          eq(githubIssueIntakes.projectId, project.id),
          eq(githubIssueIntakes.issueNumber, 42),
        ),
      );
    expect(intake?.status).toBe("redirected");

    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.kind, "github_issue_redirected"));
    expect(event).toBeTruthy();
  });

  it("skips pull request issues", async () => {
    const { project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const github = createFakeGitHubClient();

    const result = await intakeOpenedIssue(db, github, {
      projectId: project.id,
      issueNumber: 42,
      title: "PR issue",
      htmlUrl: ISSUE_URL,
      isPullRequest: true,
      publicBaseUrl: PUBLIC_URL,
    });

    expect(result).toBeNull();
    expect(github.issueActions).toHaveLength(0);
  });

  it("is idempotent for the same issue number", async () => {
    const { project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const github = createFakeGitHubClient();

    const first = await intakeOpenedIssue(db, github, {
      projectId: project.id,
      issueNumber: 42,
      title: "質問",
      htmlUrl: ISSUE_URL,
      isPullRequest: false,
      publicBaseUrl: PUBLIC_URL,
    });
    const second = await intakeOpenedIssue(db, github, {
      projectId: project.id,
      issueNumber: 42,
      title: "質問",
      htmlUrl: ISSUE_URL,
      isPullRequest: false,
      publicBaseUrl: PUBLIC_URL,
    });

    expect(second?.threadId).toBe(first?.threadId);
    const threadRows = await db.select().from(threads);
    expect(threadRows.filter((t) => t.type === "consultation")).toHaveLength(1);
  });

  it("reuses thread and retries GitHub write when comment failed", async () => {
    const { project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const github = createFakeGitHubClient();
    let callCount = 0;
    const original = github.commentAndCloseIssue.bind(github);
    github.commentAndCloseIssue = async (input) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("github write failed");
      }
      return original(input);
    };

    await expect(
      intakeOpenedIssue(db, github, {
        projectId: project.id,
        issueNumber: 42,
        title: "質問",
        htmlUrl: ISSUE_URL,
        isPullRequest: false,
        publicBaseUrl: PUBLIC_URL,
      }),
    ).rejects.toThrow("github write failed");

    const intakes = await db.select().from(githubIssueIntakes);
    expect(intakes).toHaveLength(0);

    const result = await intakeOpenedIssue(db, github, {
      projectId: project.id,
      issueNumber: 42,
      title: "質問",
      htmlUrl: ISSUE_URL,
      isPullRequest: false,
      publicBaseUrl: PUBLIC_URL,
    });
    expect(result?.skipped).toBe(false);
    const threadRows = await db.select().from(threads);
    expect(threadRows.filter((t) => t.type === "consultation")).toHaveLength(1);
    expect(github.issueActions).toHaveLength(1);
  });
});
