import { and, desc, eq, isNull } from "drizzle-orm";
import { agentCredentials } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { NotFoundError, PermissionDenied } from "./errors.js";
import { getParticipant } from "./helpers.js";

export const IDENTITY_CLIENT_LABELS = [
  "web",
  "cli",
  "init",
  "register",
  "manual",
] as const;

export type IdentityClientLabel = (typeof IDENTITY_CLIENT_LABELS)[number];

export const AGENT_CLIENT_LABEL = "agent";

export function normalizeIdentityClientLabel(
  value: string | null | undefined,
): IdentityClientLabel {
  if (value && IDENTITY_CLIENT_LABELS.includes(value as IdentityClientLabel)) {
    return value as IdentityClientLabel;
  }
  return "manual";
}

export async function listIdentityCredentials(
  db: Db,
  participantId: string,
  currentCredentialId?: string | null,
) {
  const person = await getParticipant(db, participantId);
  if (person.kind !== "human") {
    throw new PermissionDenied("人間だけがログインセッションを確認できます");
  }

  const rows = await db
    .select({
      id: agentCredentials.id,
      clientLabel: agentCredentials.clientLabel,
      createdAt: agentCredentials.createdAt,
    })
    .from(agentCredentials)
    .where(
      and(
        eq(agentCredentials.participantId, participantId),
        isNull(agentCredentials.projectId),
        isNull(agentCredentials.revokedAt),
      ),
    )
    .orderBy(desc(agentCredentials.createdAt));

  return rows.map((row) => ({
    id: row.id,
    clientLabel: normalizeIdentityClientLabel(row.clientLabel),
    createdAt: row.createdAt.toISOString(),
    current: row.id === currentCredentialId,
  }));
}

export async function revokeIdentityCredential(
  db: Db,
  input: { participantId: string; credentialId: string },
) {
  const person = await getParticipant(db, input.participantId);
  if (person.kind !== "human") {
    throw new PermissionDenied("人間だけがログインセッションを無効化できます");
  }

  const [credential] = await db
    .select()
    .from(agentCredentials)
    .where(
      and(
        eq(agentCredentials.id, input.credentialId),
        eq(agentCredentials.participantId, input.participantId),
        isNull(agentCredentials.projectId),
        isNull(agentCredentials.revokedAt),
      ),
    )
    .limit(1);

  if (!credential) {
    throw new NotFoundError("ログインセッションが見つかりません");
  }

  await db
    .update(agentCredentials)
    .set({ revokedAt: new Date() })
    .where(eq(agentCredentials.id, credential.id));

  return { revokedCredentialId: credential.id };
}
