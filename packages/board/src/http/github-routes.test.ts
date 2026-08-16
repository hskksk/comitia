import "../test/helpers.js";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projects, threadPullRequests } from "../db/schema.js";
import { db } from "../test/helpers.js";
import {
  seedDecidedImplementation,
  seedOwnerAgentProject,
} from "../test/human-fixtures.js";
import { createBoardApp } from "./app.js";
import { handleGithubEvent } from "./github-routes.js";
import { createFakeGitHubClient } from "../github/fake-client.js";
import { hashToken, issueToken } from "../domain/credentials.js";
import { agentCredentials } from "../db/schema.js";
import { linkPullRequest } from "../domain/pull-requests.js";

const PR_URL = "https://github.com/hskksk/comitia/pull/101";
const WEBHOOK_SECRET = "test-webhook-secret";

async function ownerAuthHeader(ownerId: string, projectId: string) {
  const token = issueToken();
  await db.insert(agentCredentials).values({
    participantId: ownerId,
    projectId,
    tokenHash: hashToken(token),
  });
  return { authorization: `Bearer ${token}` };
}

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

function signWebhook(body: string) {
  const digest = createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  return `sha256=${digest}`;
}

describe("handleGithubEvent", () => {
  it("syncs linked pull_request events", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const github = createFakeGitHubClient({
      pullRequests: [
        {
          owner: "hskksk",
          repo: "comitia",
          number: 101,
          url: PR_URL,
          title: "Fix typo",
          state: "open",
        },
      ],
    });
    await linkPullRequest(db, github, {
      threadId: thread.id,
      actorId: agent.id,
      url: PR_URL,
    });
    github.setPullRequest({
      owner: "hskksk",
      repo: "comitia",
      number: 101,
      url: PR_URL,
      title: "Fix typo",
      state: "merged",
    });

    await handleGithubEvent(db, github, {
      event: "pull_request",
      publicBaseUrl: "https://board.example.com",
      payload: {
        repository: { full_name: "hskksk/comitia" },
        pull_request: {
          number: 101,
          title: "Fix typo",
          state: "closed",
          merged_at: "2026-08-16T00:00:00Z",
        },
      },
    });

    const [row] = await db
      .select()
      .from(threadPullRequests)
      .where(eq(threadPullRequests.threadId, thread.id));
    expect(row?.state).toBe("merged");
  });

  it("redirects issues.opened", async () => {
    const { project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const github = createFakeGitHubClient();

    await handleGithubEvent(db, github, {
      event: "issues",
      publicBaseUrl: "https://board.example.com",
      payload: {
        action: "opened",
        repository: { full_name: "hskksk/comitia" },
        issue: {
          number: 7,
          title: "質問",
          html_url: "https://github.com/hskksk/comitia/issues/7",
        },
      },
    });

    expect(github.issueActions).toHaveLength(1);
  });
});

describe("POST /v1/github/webhook", () => {
  it("rejects invalid signatures", async () => {
    const app = createBoardApp({
      db,
      github: createFakeGitHubClient(),
      webhookSecret: WEBHOOK_SECRET,
    });
    const body = JSON.stringify({ zen: "test" });
    const res = await app.request("/v1/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "ping",
        "x-hub-signature-256": "sha256=bad",
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("accepts valid signatures", async () => {
    const app = createBoardApp({
      db,
      github: createFakeGitHubClient(),
      webhookSecret: WEBHOOK_SECRET,
    });
    const body = JSON.stringify({ zen: "test" });
    const res = await app.request("/v1/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "ping",
        "x-hub-signature-256": signWebhook(body),
      },
      body,
    });
    expect(res.status).toBe(202);
  });
});

describe("GET /v1/inbox poll refresh", () => {
  it("shows merged PR state after stale sync", async () => {
    const github = createFakeGitHubClient({
      pullRequests: [
        {
          owner: "hskksk",
          repo: "comitia",
          number: 101,
          url: PR_URL,
          title: "Fix typo",
          state: "open",
        },
      ],
    });
    const app = createBoardApp({ db, github });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    await linkPullRequest(db, github, {
      threadId: thread.id,
      actorId: agent.id,
      url: PR_URL,
    });
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    await db
      .update(threadPullRequests)
      .set({ syncedAt: stale })
      .where(eq(threadPullRequests.threadId, thread.id));
    github.setPullRequest({
      owner: "hskksk",
      repo: "comitia",
      number: 101,
      url: PR_URL,
      title: "Fix typo",
      state: "merged",
    });

    const headers = await ownerAuthHeader(owner.id, project.id);
    const res = await app.request("/v1/inbox", { headers });
    const body = (await res.json()) as {
      items: Array<{ pullRequests: Array<{ state: string }> }>;
    };
    expect(body.items[0]?.pullRequests[0]?.state).toBe("merged");
  });
});
