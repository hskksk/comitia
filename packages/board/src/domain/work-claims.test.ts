import "../test/helpers.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events, posts, workClaims } from "../db/schema.js";
import { db } from "../test/helpers.js";
import {
  seedDecidedImplementation,
  seedOwnerAgentProject,
} from "../test/human-fixtures.js";
import { registerParticipant } from "./participants.js";
import { declare } from "./declare.js";
import { openOrGetSession, endSession } from "./sessions.js";
import { createThread } from "./threads.js";
import { GateViolation, NotFoundError, PermissionDenied } from "./errors.js";
import {
  activeClaimantsByThreadId,
  claimPathsOverlap,
  claimWork,
  listActiveProjectClaims,
  listActiveThreadClaims,
  listUnclaimedDecidedImplementations,
  releaseWork,
  uniqueClaimantDisplayNames,
} from "./work-claims.js";

describe("uniqueClaimantDisplayNames", () => {
  it("dedupes by participantId while preserving first-seen order", () => {
    expect(
      uniqueClaimantDisplayNames([
        { participantId: "p1", displayName: "ハル" },
        { participantId: "p2", displayName: "ミカ" },
        { participantId: "p1", displayName: "ハル" },
      ]),
    ).toEqual(["ハル", "ミカ"]);
  });
});

describe("activeClaimantsByThreadId", () => {
  it("groups claimants per thread", () => {
    const map = activeClaimantsByThreadId([
      { threadId: "t1", participantId: "p1", displayName: "ハル" },
      { threadId: "t2", participantId: "p2", displayName: "ミカ" },
      { threadId: "t1", participantId: "p3", displayName: "リン" },
    ]);
    expect(map.get("t1")).toEqual(["ハル", "リン"]);
    expect(map.get("t2")).toEqual(["ミカ"]);
  });
});

describe("claimPathsOverlap", () => {
  it("treats a prefix directory as overlapping", () => {
    expect(claimPathsOverlap(["docs/"], ["docs/README.md"])).toBe(true);
  });

  it("does not treat sibling directories with a shared prefix as overlapping", () => {
    expect(claimPathsOverlap(["packages/web"], ["packages/web2"])).toBe(false);
  });

  it("treats \".\" as overlapping everything", () => {
    expect(claimPathsOverlap(["."], ["packages/board/src/index.ts"])).toBe(true);
  });

  it("treats an exact match as overlapping", () => {
    expect(claimPathsOverlap(["docs/README.md"], ["docs/README.md"])).toBe(true);
  });
});

describe("claimWork", () => {
  it("rejects empty paths", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });

    await expect(
      claimWork(db, { threadId: thread.id, participantId: agent.id, paths: [] }),
    ).rejects.toThrow(GateViolation);
  });

  it("lets overlapping claims from different agents both stay active", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const otherAgent = await registerParticipant(db, {
      kind: "agent",
      displayName: "リン",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const first = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
      title: "最初のスレッド",
    });
    const second = await seedDecidedImplementation(db, {
      agentId: otherAgent.id,
      projectId: project.id,
      title: "二番目のスレッド",
    });

    const firstClaim = await claimWork(db, {
      threadId: first.thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });
    expect(firstClaim.claim.active).toBe(true);
    expect(firstClaim.overlaps).toHaveLength(0);

    const secondClaim = await claimWork(db, {
      threadId: second.thread.id,
      participantId: otherAgent.id,
      paths: ["docs/README.md"],
    });
    expect(secondClaim.claim.active).toBe(true);
    expect(secondClaim.overlaps).toHaveLength(1);
    expect(secondClaim.overlaps[0]).toMatchObject({
      claimId: firstClaim.claim.id,
      threadId: first.thread.id,
      threadTitle: "最初のスレッド",
      participantId: agent.id,
      displayName: agent.displayName,
      paths: ["docs/"],
    });

    const [firstRow] = await db
      .select()
      .from(workClaims)
      .where(eq(workClaims.id, firstClaim.claim.id));
    expect(firstRow?.active).toBe(true);
  });

  it("inserts exactly one report post", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });

    await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    const reportPosts = await db
      .select()
      .from(posts)
      .where(eq(posts.threadId, thread.id));
    const reports = reportPosts.filter((post) => post.type === "report");
    expect(reports).toHaveLength(1);
  });

  it("records a work_claimed event", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });

    await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.threadId, thread.id));
    expect(rows.some((row) => row.kind === "work_claimed")).toBe(true);
  });
});

describe("releaseWork", () => {
  it("rejects release by a different participant", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const otherAgent = await registerParticipant(db, {
      kind: "agent",
      displayName: "リン",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const { claim } = await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    await expect(
      releaseWork(db, { claimId: claim.id, actorId: otherAgent.id }),
    ).rejects.toThrow(PermissionDenied);
  });

  it("releases the claim for the owning participant and records an event", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const { claim } = await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    const released = await releaseWork(db, { claimId: claim.id, actorId: agent.id });
    expect(released.active).toBe(false);
    expect(released.releasedAt).not.toBeNull();

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.threadId, thread.id));
    expect(rows.some((row) => row.kind === "work_released")).toBe(true);
  });

  it("rejects release when the given threadId does not match the claim's thread", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
      title: "対象スレッド",
    });
    const other = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
      title: "別スレッド",
    });
    const { claim } = await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    await expect(
      releaseWork(db, {
        claimId: claim.id,
        actorId: agent.id,
        threadId: other.thread.id,
      }),
    ).rejects.toThrow(NotFoundError);

    const [row] = await db
      .select()
      .from(workClaims)
      .where(eq(workClaims.id, claim.id));
    expect(row?.active).toBe(true);
  });
});

describe("session end vs thread completion", () => {
  it("does not release a claim when the session ends", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const { claim } = await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    const session = await openOrGetSession(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    await endSession(db, { sessionId: session.id, handover: "続きは明日" });

    const [row] = await db
      .select()
      .from(workClaims)
      .where(eq(workClaims.id, claim.id));
    expect(row?.active).toBe(true);
  });

  it("releases active claims when the thread completes", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const { claim } = await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "complete_thread",
      payload: {},
    });

    const [row] = await db
      .select()
      .from(workClaims)
      .where(eq(workClaims.id, claim.id));
    expect(row?.active).toBe(false);
    expect(row?.releasedAt).not.toBeNull();

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.threadId, thread.id));
    const releaseEvent = rows.find((row2) => row2.kind === "work_released");
    expect((releaseEvent?.payload as { reason?: string } | undefined)?.reason).toBe(
      "thread_closed",
    );
  });

  it("releases active claims when the thread is rejected", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "consultation",
      title: "検討",
      trigger: "確認",
      duplicateSearchQuery: "検討",
      conflictCitationsChecked: true,
    });
    const { claim } = await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "reject_thread",
      payload: {},
    });

    const [row] = await db
      .select()
      .from(workClaims)
      .where(eq(workClaims.id, claim.id));
    expect(row?.active).toBe(false);
  });
});

describe("read helpers", () => {
  it("lists active claims for a project and a thread", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    const projectClaims = await listActiveProjectClaims(db, project.id);
    expect(projectClaims).toHaveLength(1);
    expect(projectClaims[0]?.threadTitle).toBe(thread.title);

    const threadClaims = await listActiveThreadClaims(db, thread.id);
    expect(threadClaims).toHaveLength(1);
    expect(threadClaims[0]?.displayName).toBe(agent.displayName);
  });

  it("lists decided implementation threads with no active claim and no PR", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });

    const before = await listUnclaimedDecidedImplementations(db, project.id);
    expect(before.map((row) => row.id)).toContain(thread.id);

    await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    const after = await listUnclaimedDecidedImplementations(db, project.id);
    expect(after.map((row) => row.id)).not.toContain(thread.id);
  });
});
