import "../test/helpers.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentCredentials } from "../db/schema.js";
import { db } from "../test/helpers.js";
import { issueIdentityToken } from "./accounts.js";
import { authenticateToken } from "./credentials.js";
import { registerParticipant } from "./participants.js";

describe("identity tokens", () => {
  it("issues multiple concurrent tokens for the same human", async () => {
    const human = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });

    const first = await issueIdentityToken(db, human.id);
    const second = await issueIdentityToken(db, human.id);

    expect(first).not.toBe(second);
    expect(await authenticateToken(db, first)).toMatchObject({
      participant: { id: human.id },
    });
    expect(await authenticateToken(db, second)).toMatchObject({
      participant: { id: human.id },
    });

    const rows = await db
      .select()
      .from(agentCredentials)
      .where(eq(agentCredentials.participantId, human.id));
    expect(rows).toHaveLength(2);
  });
});
