import { and, eq } from "drizzle-orm";
import { agreements } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { NotFoundError } from "./errors.js";
import { assertProjectOwner } from "./helpers.js";

export async function searchAgreements(
  db: Db,
  input: {
    projectId: string;
    onlyActiveBinding?: boolean;
  },
) {
  const conditions = [eq(agreements.projectId, input.projectId)];
  if (input.onlyActiveBinding) {
    conditions.push(eq(agreements.state, "active"));
    conditions.push(eq(agreements.binding, true));
  }

  return db
    .select()
    .from(agreements)
    .where(and(...conditions));
}

export async function supersedeAgreement(
  db: Db,
  input: {
    agreementId: string;
    byAgreementId: string;
    actorId: string;
  },
) {
  const [agreement] = await db
    .select()
    .from(agreements)
    .where(eq(agreements.id, input.agreementId));
  if (!agreement) {
    throw new NotFoundError("合意物が見つかりません");
  }

  await assertProjectOwner(db, agreement.projectId, input.actorId);

  const [updated] = await db
    .update(agreements)
    .set({
      state: "superseded",
      supersededByAgreementId: input.byAgreementId,
    })
    .where(eq(agreements.id, input.agreementId))
    .returning();

  await recordEvent(db, {
    projectId: agreement.projectId,
    threadId: agreement.threadId,
    actorParticipantId: input.actorId,
    kind: "agreement_superseded",
    payload: {
      agreementId: input.agreementId,
      byAgreementId: input.byAgreementId,
    },
  });

  return updated!;
}
