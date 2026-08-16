import "../test/helpers.js";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentConnections, agentCredentials, participants } from "../db/schema.js";
import { db } from "../test/helpers.js";
import { authenticateToken } from "./credentials.js";
import { assignSessionStartMinute } from "./connections.js";
import { bootstrapBoard, registerAgent } from "./bootstrap.js";

describe("bootstrap", () => {
  it("creates owner, project, and owner token once", async () => {
    const first = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    expect(first.owner.kind).toBe("human");
    expect(first.ownerToken.startsWith("comt_")).toBe(true);

    await expect(
      bootstrapBoard(db, {
        ownerDisplayName: "別",
        projectName: "x",
      }),
    ).rejects.toThrow(/already initialized/);

    const auth = await authenticateToken(db, first.ownerToken);
    expect(auth?.participant.id).toBe(first.owner.id);

    const registered = await registerAgent(db, {
      ownerParticipantId: first.owner.id,
      displayName: "ミカ",
      engine: "claude-code",
    });
    expect(registered.projectId).toBe(first.project.id);
    const agentAuth = await authenticateToken(db, registered.agentToken);
    expect(agentAuth?.participant.id).toBe(registered.agent.id);
    expect(agentAuth?.projectId).toBe(first.project.id);
  });

  it("stores optional repoUrl on the project", async () => {
    const result = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
      repoUrl: "https://github.com/hskksk/comitia",
    });
    expect(result.project.repoUrl).toBe("https://github.com/hskksk/comitia");
  });

  it("rolls back bootstrap when project creation fails", async () => {
    await db.execute(sql`
      ALTER TABLE projects
      ADD CONSTRAINT reject_bootstrap_project
      CHECK (name <> 'reject')
    `);

    await expect(
      bootstrapBoard(db, {
        ownerDisplayName: "ハル",
        projectName: "reject",
      }),
    ).rejects.toThrow();

    const retried = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    expect(retried.project.name).toBe("comitia");
  });

  it("rolls back agent registration when connection creation fails", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    await db.execute(sql`
      ALTER TABLE agent_connections
      ADD CONSTRAINT reject_agent_connection
      CHECK (session_start_minute < 0)
    `);

    await expect(
      registerAgent(db, {
        ownerParticipantId: boot.owner.id,
        displayName: "ミカ",
        engine: "claude-code",
      }),
    ).rejects.toThrow();

    const orphanedAgents = await db
      .select()
      .from(participants)
      .where(eq(participants.kind, "agent"));
    const credentials = await db.select().from(agentCredentials);
    expect(orphanedAgents).toEqual([]);
    expect(credentials).toHaveLength(1);
  });

  it("rejects engine other than claude-code", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    await expect(
      registerAgent(db, {
        ownerParticipantId: boot.owner.id,
        displayName: "ソウ",
        engine: "opencode",
      }),
    ).rejects.toThrow(/claude-code/);
  });

  it("assigns staggered connection start minutes", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "ミカ",
      engine: "claude-code",
    });
    await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "ソウ",
      engine: "claude-code",
    });

    const connections = await db
      .select()
      .from(agentConnections)
      .orderBy(asc(agentConnections.sessionStartMinute));
    expect(connections.map((connection) => connection.sessionStartMinute)).toEqual([0, 15]);
    expect(assignSessionStartMinute(96)).toBe(0);
  });
});
