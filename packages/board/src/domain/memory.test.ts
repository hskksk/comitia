import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { seedOwnerAgentProject } from "../test/human-fixtures.js";
import { registerParticipant } from "./participants.js";
import { PermissionDenied, NotFoundError } from "./errors.js";
import { listActiveMemory, writeMemory } from "./memory.js";

describe("writeMemory / listActiveMemory", () => {
  it("appends a new active memory row", async () => {
    const { agent } = await seedOwnerAgentProject(db);

    await writeMemory(db, { participantId: agent.id, body: "矛盾に気づいた" });

    const active = await listActiveMemory(db, agent.id);
    expect(active).toHaveLength(1);
    expect(active[0]?.body).toBe("矛盾に気づいた");
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
});
