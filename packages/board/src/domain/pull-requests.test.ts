import "../test/helpers.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projects, threadPullRequests } from "../db/schema.js";
import { db } from "../test/helpers.js";
import {
  seedDecidedImplementation,
  seedOwnerAgentProject,
} from "../test/human-fixtures.js";
import { GateViolation } from "./errors.js";
import {
  linkPullRequest,
  refreshStalePullRequests,
  syncPullRequest,
} from "./pull-requests.js";
import { createFakeGitHubClient } from "../github/fake-client.js";

const PR_URL = "https://github.com/hskksk/comitia/pull/101";

async function connectProject(
  projectId: string,
  installationId = "inst-1",
) {
  await db
    .update(projects)
    .set({
      githubInstallationId: installationId,
      githubOwner: "hskksk",
      githubRepo: "comitia",
      repoUrl: "https://github.com/hskksk/comitia",
    })
    .where(eq(projects.id, projectId));
}

describe("linkPullRequest", () => {
  it("links a PR and records pull_request_linked", async () => {
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

    const row = await linkPullRequest(db, github, {
      threadId: thread.id,
      actorId: agent.id,
      url: PR_URL,
    });
    expect(row.state).toBe("open");
    expect(row.number).toBe(101);
  });

  it("rejects wrong owner/repo", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const github = createFakeGitHubClient();

    await expect(
      linkPullRequest(db, github, {
        threadId: thread.id,
        actorId: agent.id,
        url: "https://github.com/other/repo/pull/1",
      }),
    ).rejects.toThrow(GateViolation);
  });

  it("rejects duplicate PR on another thread", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const first = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
      title: "first",
    });
    const second = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
      title: "second",
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
      threadId: first.thread.id,
      actorId: agent.id,
      url: PR_URL,
    });

    await expect(
      linkPullRequest(db, github, {
        threadId: second.thread.id,
        actorId: agent.id,
        url: PR_URL,
      }),
    ).rejects.toThrow(GateViolation);
  });

  it("rejects when installation is missing", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const github = createFakeGitHubClient();

    await expect(
      linkPullRequest(db, github, {
        threadId: thread.id,
        actorId: agent.id,
        url: PR_URL,
      }),
    ).rejects.toThrow(GateViolation);
  });
});

describe("syncPullRequest", () => {
  it("updates merged state and records pull_request_synced", async () => {
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

    const updated = await syncPullRequest(db, github, {
      projectId: project.id,
      number: 101,
    });
    expect(updated?.state).toBe("merged");
  });

  it("no-ops for unlinked PR numbers", async () => {
    const { project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const github = createFakeGitHubClient();
    const result = await syncPullRequest(db, github, {
      projectId: project.id,
      number: 999,
    });
    expect(result).toBeNull();
  });
});

describe("refreshStalePullRequests", () => {
  it("refreshes rows with old syncedAt", async () => {
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
      title: "Fix typo merged",
      state: "merged",
    });

    await refreshStalePullRequests(db, github, {
      projectId: project.id,
      maxAgeMs: 5 * 60 * 1000,
    });

    const [row] = await db
      .select()
      .from(threadPullRequests)
      .where(eq(threadPullRequests.threadId, thread.id));
    expect(row?.state).toBe("merged");
    expect(row?.title).toBe("Fix typo merged");
  });
});
