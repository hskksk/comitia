import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import {
  seedAwaitingRatification,
  seedDecidedImplementation,
  seedOwnerAgentProject,
} from "../test/human-fixtures.js";
import { declare } from "./declare.js";
import {
  getHumanThreadView,
  listJudgmentQueue,
  listNonblockingInbox,
} from "./human-views.js";

import { createFakeGitHubClient } from "../github/fake-client.js";
import { eq } from "drizzle-orm";
import { projects } from "../db/schema.js";
import { linkPullRequest } from "./pull-requests.js";

const PR_URL = "https://github.com/hskksk/comitia/pull/101";

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

describe("listNonblockingInbox pull requests", () => {
  it("includes linked PR rows on decided implementation threads", async () => {
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

    const inbox = await listNonblockingInbox(db, { projectId: project.id });
    expect(inbox[0]?.pullRequests[0]?.number).toBe(101);
    expect(inbox[0]?.pullRequests[0]?.state).toBe("open");
  });

  it("returns empty pullRequests when none are linked", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const inbox = await listNonblockingInbox(db, { projectId: project.id });
    expect(inbox[0]?.pullRequests).toEqual([]);
  });
});

describe("listJudgmentQueue", () => {
  it("lists awaiting_decision threads with latest synthesis, oldest first", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const first = await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
      title: "先に入った",
      synthesis: "決めるのは区分の是非",
    });
    const second = await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
      title: "後から入った",
    });

    const queue = await listJudgmentQueue(db, { projectId: project.id });
    expect(queue.map((item) => item.threadId)).toEqual([
      first.thread.id,
      second.thread.id,
    ]);
    expect(queue[0]?.synthesis?.body).toBe("決めるのは区分の是非");
    expect(queue[0]?.candidateProposal?.content).toBe("区分を導入する");
    expect(queue[0]?.consensusType).toBe("human_ratification");
    expect(Number.isNaN(Date.parse(queue[0]!.enteredAt))).toBe(false);
  });

  it("omits discussing and decided threads", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const awaiting = await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
    });

    const queue = await listJudgmentQueue(db, { projectId: project.id });
    expect(queue.map((item) => item.threadId)).toEqual([awaiting.thread.id]);
  });
});

describe("listNonblockingInbox", () => {
  it("lists decided implementation/review threads that are not completed", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const open = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
      title: "マージ待ち",
      report: "PR 相当の作業が終わった",
    });
    const done = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
      title: "もう完了",
    });
    await declare(db, {
      threadId: done.thread.id,
      actorId: agent.id,
      kind: "complete_thread",
      payload: {},
    });
    await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
    });

    const inbox = await listNonblockingInbox(db, { projectId: project.id });
    expect(inbox.map((item) => item.threadId)).toEqual([open.thread.id]);
    expect(inbox[0]?.kind).toBe("post_review");
    expect(inbox[0]?.latestReport?.body).toBe("PR 相当の作業が終わった");
  });

  it("marks implementation without a report as merge_wait", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const inbox = await listNonblockingInbox(db, { projectId: project.id });
    expect(inbox[0]?.kind).toBe("merge_wait");
    expect(inbox[0]?.latestReport).toBeNull();
  });
});

describe("getHumanThreadView", () => {
  it("returns synthesis, candidate, and posts with author names", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const seeded = await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
      synthesis: "争点は遡及の扱い",
    });

    const view = await getHumanThreadView(db, seeded.thread.id);
    expect(view.thread.id).toBe(seeded.thread.id);
    expect(view.thread.projectId).toBe(project.id);
    expect(view.thread.state).toBe("awaiting_decision");
    expect(view.synthesis?.body).toBe("争点は遡及の扱い");
    expect(view.candidateProposal?.content).toBe("区分を導入する");
    expect(view.posts.some((post) => post.authorDisplayName === "ミカ")).toBe(
      true,
    );
  });
});
