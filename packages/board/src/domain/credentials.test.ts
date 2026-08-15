import "../test/helpers.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentCredentials } from "../db/schema.js";
import { db } from "../test/helpers.js";
import { createProject } from "./projects.js";
import { registerParticipant } from "./participants.js";
import { authenticateToken, hashToken, issueToken } from "./credentials.js";

describe("credentials", () => {
  it("hashes and issues tokens in the required format", () => {
    expect(hashToken("comitia")).toBe(
      "29f2dfde16b9692cb3e77c089e6fdecb7480d65dafeb9d62ce540f795d7d0638",
    );
    expect(issueToken()).toMatch(/^comt_[0-9a-f]{64}$/);
  });

  it("authenticates an issued token and rejects unknown or revoked tokens", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "comitia",
      ownerParticipantId: owner.id,
    });
    const token = issueToken();
    await db.insert(agentCredentials).values({
      participantId: owner.id,
      projectId: project.id,
      tokenHash: hashToken(token),
    });

    const authenticated = await authenticateToken(db, token);
    expect(authenticated?.participant.id).toBe(owner.id);
    expect(authenticated?.projectId).toBe(project.id);
    expect(await authenticateToken(db, "different-token")).toBeNull();

    await db
      .update(agentCredentials)
      .set({ revokedAt: new Date() })
      .where(eq(agentCredentials.participantId, owner.id));
    expect(await authenticateToken(db, token)).toBeNull();
  });
});
