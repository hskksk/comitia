import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { agentCredentials, participants } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";

const TOKEN_FORMAT_RE = /^comt_[0-9a-f]{64}$/;

export function isTokenFormat(token: string): boolean {
  return TOKEN_FORMAT_RE.test(token);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueToken(): string {
  return `comt_${randomBytes(32).toString("hex")}`;
}

export async function authenticateToken(db: Db, token: string) {
  const [authenticated] = await db
    .select({
      credentialId: agentCredentials.id,
      participant: participants,
      projectId: agentCredentials.projectId,
      clientLabel: agentCredentials.clientLabel,
    })
    .from(agentCredentials)
    .innerJoin(participants, eq(agentCredentials.participantId, participants.id))
    .where(
      and(
        eq(agentCredentials.tokenHash, hashToken(token)),
        isNull(agentCredentials.revokedAt),
      ),
    )
    .limit(1);

  return authenticated ?? null;
}
