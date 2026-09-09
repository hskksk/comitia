import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_BUDGET,
  RETRO_DUE_ENDED_SESSION_COUNT,
  WIND_DOWN_RESERVE,
} from "@comitia/shared";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { events, participants, sessions } from "../db/schema.js";
import { seedOwnerAgentProject } from "../test/human-fixtures.js";
import { registerParticipant } from "./participants.js";
import { PermissionDenied, NotFoundError, GateViolation } from "./errors.js";
import {
  isRetroDueForParticipant,
  listActiveMemory,
  writeMemory,
} from "./memory.js";

async function insertEndedSessions(
  participantId: string,
  count: number,
  startedAt: Date,
) {
  if (count === 0) return;
  await db.insert(sessions).values(
    Array.from({ length: count }, (_, index) => {
      const started = new Date(startedAt.getTime() + index * 2);
      return {
        participantId,
        budgetLimit: DEFAULT_SESSION_BUDGET,
        windDownReserved: WIND_DOWN_RESERVE,
        startedAt: started,
        endedAt: new Date(started.getTime() + 1),
        endedReason: "completed" as const,
      };
    }),
  );
}

describe("writeMemory / listActiveMemory", () => {
  it("appends a new active memory row", async () => {
    const { agent } = await seedOwnerAgentProject(db);

    await writeMemory(db, { participantId: agent.id, body: "矛盾に気づいた" });

    const active = await listActiveMemory(db, agent.id);
    expect(active).toHaveLength(1);
    expect(active[0]?.body).toBe("矛盾に気づいた");
    expect(active[0]?.layer).toBe("episodic");
  });

  it("defaults omitted layer to episodic", async () => {
    const { agent } = await seedOwnerAgentProject(db);

    const row = await writeMemory(db, {
      participantId: agent.id,
      body: "既定層",
    });

    expect(row.layer).toBe("episodic");
  });

  it("supersede replaces the own row and hides the old one", async () => {
    const { agent } = await seedOwnerAgentProject(db);
    const first = await writeMemory(db, {
      participantId: agent.id,
      body: "最初のメモ",
    });

    await writeMemory(db, {
      participantId: agent.id,
      body: "更新したメモ",
      supersedeId: first.id,
    });

    const active = await listActiveMemory(db, agent.id);
    expect(active).toHaveLength(1);
    expect(active[0]?.body).toBe("更新したメモ");
    expect(active[0]?.layer).toBe("episodic");
  });

  it("rejects superseding another participant's memory", async () => {
    const { owner, agent } = await seedOwnerAgentProject(db);
    const other = await registerParticipant(db, {
      kind: "agent",
      displayName: "リン",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const first = await writeMemory(db, {
      participantId: agent.id,
      body: "本人のメモ",
    });

    await expect(
      writeMemory(db, {
        participantId: other.id,
        body: "乗っ取り",
        supersedeId: first.id,
      }),
    ).rejects.toThrow(PermissionDenied);
  });

  it("rejects superseding a nonexistent memory id", async () => {
    const { agent } = await seedOwnerAgentProject(db);

    await expect(
      writeMemory(db, {
        participantId: agent.id,
        body: "存在しないIDへの更新",
        supersedeId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("scopes listActiveMemory to the given participant only", async () => {
    const { owner, agent } = await seedOwnerAgentProject(db);
    const other = await registerParticipant(db, {
      kind: "agent",
      displayName: "リン",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    await writeMemory(db, { participantId: agent.id, body: "エージェントAのメモ" });
    await writeMemory(db, { participantId: other.id, body: "エージェントBのメモ" });

    const active = await listActiveMemory(db, agent.id);
    expect(active).toHaveLength(1);
    expect(active[0]?.body).toBe("エージェントAのメモ");
  });

  it("writes a norm on its own layer and keeps episodic rows separate", async () => {
    const { agent } = await seedOwnerAgentProject(db);
    await writeMemory(db, {
      participantId: agent.id,
      body: "個別の気づき",
    });
    await writeMemory(db, {
      participantId: agent.id,
      body: "対立する案を残す",
      layer: "norm",
    });

    const all = await listActiveMemory(db, agent.id);
    const episodic = await listActiveMemory(db, agent.id, { layer: "episodic" });
    const norms = await listActiveMemory(db, agent.id, { layer: "norm" });

    expect(all).toHaveLength(2);
    expect(episodic.map((row) => row.body)).toEqual(["個別の気づき"]);
    expect(norms.map((row) => row.body)).toEqual(["対立する案を残す"]);
  });

  it("rejects superseding across layers", async () => {
    const { agent } = await seedOwnerAgentProject(db);
    const episodic = await writeMemory(db, {
      participantId: agent.id,
      body: "個別",
    });
    const norm = await writeMemory(db, {
      participantId: agent.id,
      body: "規範",
      layer: "norm",
    });

    await expect(
      writeMemory(db, {
        participantId: agent.id,
        body: "規範で上書き",
        layer: "norm",
        supersedeId: episodic.id,
      }),
    ).rejects.toThrow(GateViolation);

    await expect(
      writeMemory(db, {
        participantId: agent.id,
        body: "個別で上書き",
        supersedeId: norm.id,
      }),
    ).rejects.toThrow(GateViolation);
  });

  it("supersedes a norm with another norm and records memory_written", async () => {
    const { agent } = await seedOwnerAgentProject(db);
    const first = await writeMemory(db, {
      participantId: agent.id,
      body: "旧規範",
      layer: "norm",
    });

    const next = await writeMemory(db, {
      participantId: agent.id,
      body: "新規範",
      layer: "norm",
      supersedeId: first.id,
    });

    const active = await listActiveMemory(db, agent.id, { layer: "norm" });
    expect(active).toHaveLength(1);
    expect(active[0]?.body).toBe("新規範");

    const written = await db
      .select()
      .from(events)
      .where(eq(events.kind, "memory_written"));
    expect(written.some((row) => (row.payload as { memoryId: string }).memoryId === next.id)).toBe(
      true,
    );
    expect(
      written.some((row) => (row.payload as { layer: string }).layer === "norm"),
    ).toBe(true);
  });

  it("sets norm_reviewed_at only when writing a norm", async () => {
    const { agent } = await seedOwnerAgentProject(db);

    await writeMemory(db, { participantId: agent.id, body: "個別" });
    const afterEpisodic = await db
      .select()
      .from(participants)
      .where(eq(participants.id, agent.id));
    expect(afterEpisodic[0]?.normReviewedAt).toBeNull();

    await writeMemory(db, {
      participantId: agent.id,
      body: "規範",
      layer: "norm",
    });
    const afterNorm = await db
      .select()
      .from(participants)
      .where(eq(participants.id, agent.id));
    expect(afterNorm[0]?.normReviewedAt).toBeInstanceOf(Date);
  });
});

describe("isRetroDueForParticipant", () => {
  it("is false until 7 sessions have ended since account creation", async () => {
    const { agent } = await seedOwnerAgentProject(db);
    const [row] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, agent.id));

    await insertEndedSessions(
      agent.id,
      RETRO_DUE_ENDED_SESSION_COUNT - 1,
      new Date(row!.createdAt.getTime() + 1),
    );
    expect(await isRetroDueForParticipant(db, agent.id)).toBe(false);

    await insertEndedSessions(
      agent.id,
      1,
      new Date(row!.createdAt.getTime() + 1_000),
    );
    expect(await isRetroDueForParticipant(db, agent.id)).toBe(true);
  });

  it("resets after a norm write and becomes due again after 7 ended sessions", async () => {
    const { agent } = await seedOwnerAgentProject(db);
    const [row] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, agent.id));

    await insertEndedSessions(
      agent.id,
      RETRO_DUE_ENDED_SESSION_COUNT,
      new Date(row!.createdAt.getTime() + 1),
    );
    expect(await isRetroDueForParticipant(db, agent.id)).toBe(true);

    await writeMemory(db, {
      participantId: agent.id,
      body: "提炼した規範",
      layer: "norm",
    });
    expect(await isRetroDueForParticipant(db, agent.id)).toBe(false);

    const [reviewed] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, agent.id));
    await insertEndedSessions(
      agent.id,
      RETRO_DUE_ENDED_SESSION_COUNT,
      new Date(reviewed!.normReviewedAt!.getTime() + 1),
    );
    expect(await isRetroDueForParticipant(db, agent.id)).toBe(true);
  });
});
