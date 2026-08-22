import { and, eq, isNull } from "drizzle-orm";
import {
  agentCredentials,
  participants,
  projectInvites,
} from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { hashToken, issueToken } from "./credentials.js";
import {
  type IdentityClientLabel,
  normalizeIdentityClientLabel,
} from "./identity-credentials.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError, PermissionDenied } from "./errors.js";
import { addMembership, assertProjectMember } from "./memberships.js";
import { getParticipant, getProject } from "./helpers.js";
import { registerParticipant } from "./participants.js";

export function isOpenSignupEnabled() {
  return process.env.COMITIA_OPEN_SIGNUP !== "0";
}

export function issueInviteToken() {
  return `comt_inv_${issueToken().slice("comt_".length)}`;
}

export async function issueIdentityToken(
  db: Db,
  participantId: string,
  clientLabel: IdentityClientLabel = "manual",
) {
  const token = issueToken();
  await db.insert(agentCredentials).values({
    participantId,
    projectId: null,
    clientLabel: normalizeIdentityClientLabel(clientLabel),
    tokenHash: hashToken(token),
  });
  return token;
}

/** @deprecated Use issueIdentityToken. Kept as an alias for existing imports. */
export const issueOrRotateIdentityToken = issueIdentityToken;

export async function registerHuman(
  db: Db,
  input: {
    displayName: string;
    githubUserId?: string;
    githubLogin?: string;
    ignoreSignupGate?: boolean;
    clientLabel?: IdentityClientLabel;
  },
) {
  if (!input.ignoreSignupGate && !isOpenSignupEnabled()) {
    throw new PermissionDenied("signup is disabled");
  }
  const human = await registerParticipant(db, {
    kind: "human",
    displayName: input.displayName,
  });
  if (input.githubUserId) {
    await db
      .update(participants)
      .set({
        githubUserId: input.githubUserId,
        githubLogin: input.githubLogin ?? null,
      })
      .where(eq(participants.id, human.id));
  }
  const token = await issueIdentityToken(
    db,
    human.id,
    input.clientLabel ?? "register",
  );
  return { human: { ...human, githubUserId: input.githubUserId ?? null, githubLogin: input.githubLogin ?? null }, token };
}

export async function updateHumanProfile(
  db: Db,
  input: { participantId: string; displayName: string },
) {
  const person = await getParticipant(db, input.participantId);
  if (person.kind !== "human") {
    throw new PermissionDenied("人間だけがプロフィールを変えられます");
  }
  const [updated] = await db
    .update(participants)
    .set({ displayName: input.displayName })
    .where(eq(participants.id, input.participantId))
    .returning();
  return updated!;
}

export async function createProjectInvite(
  db: Db,
  input: { projectId: string; actorId: string },
) {
  const project = await getProject(db, input.projectId);
  if (project.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("プロジェクトオーナーのみ実行できます");
  }
  const token = issueInviteToken();
  await db.insert(projectInvites).values({
    projectId: input.projectId,
    tokenHash: hashToken(token),
    createdByParticipantId: input.actorId,
  });
  await recordEvent(db, {
    projectId: input.projectId,
    actorParticipantId: input.actorId,
    kind: "project_invite_created",
    payload: { projectId: input.projectId },
  });
  return { token, projectId: input.projectId };
}

export async function joinProjectByInvite(
  db: Db,
  input: { participantId: string; token: string },
) {
  const person = await getParticipant(db, input.participantId);
  if (person.kind !== "human") {
    throw new PermissionDenied("人間だけが招待で参加できます");
  }
  const [invite] = await db
    .select()
    .from(projectInvites)
    .where(
      and(
        eq(projectInvites.tokenHash, hashToken(input.token)),
        isNull(projectInvites.revokedAt),
      ),
    )
    .limit(1);
  if (!invite) {
    throw new NotFoundError("招待が見つかりません");
  }
  await addMembership(db, {
    projectId: invite.projectId,
    participantId: input.participantId,
    actorId: input.participantId,
  });
  return getProject(db, invite.projectId);
}

export async function findHumanByGithubUserId(db: Db, githubUserId: string) {
  const [row] = await db
    .select()
    .from(participants)
    .where(eq(participants.githubUserId, githubUserId))
    .limit(1);
  return row ?? null;
}

export async function bindGithubIdentity(
  db: Db,
  input: {
    participantId: string;
    githubUserId: string;
    githubLogin: string;
  },
) {
  await db
    .update(participants)
    .set({
      githubUserId: input.githubUserId,
      githubLogin: input.githubLogin,
    })
    .where(eq(participants.id, input.participantId));
}

export async function findUnboundSingleHuman(db: Db) {
  const humans = await db
    .select()
    .from(participants)
    .where(eq(participants.kind, "human"));
  if (humans.length === 1 && !humans[0]!.githubUserId) {
    return humans[0]!;
  }
  return null;
}

export { assertProjectMember };
