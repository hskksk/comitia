import { and, eq, isNull } from "drizzle-orm";
import type {
  ConsensusType,
  EngineDiversity,
  ProposalTarget,
  SharedArtifactKind,
  ThreadState,
  ThreadType,
} from "@comitia/shared";
import { threadConflictCitations, threads } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation } from "./errors.js";
import {
  buildThreadTextFilter,
  countActiveBindingAgreements,
  getThreadRow,
} from "./helpers.js";

export async function createThread(
  db: Db,
  input: {
    projectId: string;
    ownerId: string;
    type: ThreadType;
    title: string;
    trigger: string;
    duplicateSearchQuery: string;
    consensusType?: ConsensusType;
    humanRequired?: boolean;
    target?: ProposalTarget;
    sharedArtifactKind?: SharedArtifactKind;
    conflictCitations?: { agreementId: string; note: string }[];
    conflictCitationsChecked?: boolean;
    parentThreadId?: string;
    engineDiversity?: EngineDiversity;
  },
) {
  if (!input.trigger.trim()) {
    throw new GateViolation("きっかけは必須です");
  }
  if (!input.duplicateSearchQuery.trim()) {
    throw new GateViolation("重複検索クエリは必須です");
  }

  if (input.type === "proposal" && !input.target) {
    throw new GateViolation("提案スレッドには対象が必須です");
  }
  if (input.target === "shared_artifact" && !input.sharedArtifactKind) {
    throw new GateViolation("共有物提案には sharedArtifactKind が必須です");
  }

  let consensusType: ConsensusType | null = input.consensusType ?? null;

  if (input.type === "brainstorm") {
    if (input.consensusType) {
      throw new GateViolation("ブレストスレッドは合意種類を持てません");
    }
    consensusType = null;
  } else if (input.sharedArtifactKind === "project_rule") {
    if (consensusType && consensusType !== "human_ratification") {
      throw new GateViolation(
        "プロジェクトルールの改正は人間批准以外の合意種類を選べません",
      );
    }
    consensusType = "human_ratification";
  } else {
    consensusType = consensusType ?? "rough";
  }

  const activeBindingCount = await countActiveBindingAgreements(
    db,
    input.projectId,
  );
  if (activeBindingCount > 0 && !input.conflictCitationsChecked) {
    throw new GateViolation(
      "拘束的な有効決定があるため、衝突チェックの証跡（conflictCitationsChecked）が必須です",
    );
  }

  const [thread] = await db
    .insert(threads)
    .values({
      projectId: input.projectId,
      type: input.type,
      ownerParticipantId: input.ownerId,
      consensusType,
      humanRequired: input.humanRequired ?? false,
      target: input.target ?? null,
      sharedArtifactKind: input.sharedArtifactKind ?? null,
      title: input.title,
      trigger: input.trigger,
      duplicateSearchQuery: input.duplicateSearchQuery,
      parentThreadId: input.parentThreadId ?? null,
      ...(input.engineDiversity ? { engineDiversity: input.engineDiversity } : {}),
    })
    .returning();

  if (input.conflictCitations?.length) {
    await db.insert(threadConflictCitations).values(
      input.conflictCitations.map((c) => ({
        threadId: thread!.id,
        agreementId: c.agreementId,
        note: c.note,
      })),
    );
  }

  await recordEvent(db, {
    projectId: input.projectId,
    threadId: thread!.id,
    actorParticipantId: input.ownerId,
    kind: "thread_created",
    payload: {
      threadId: thread!.id,
      type: input.type,
      consensusType,
      conflictCitationsChecked: input.conflictCitationsChecked ?? false,
      conflictCitationCount: input.conflictCitations?.length ?? 0,
    },
  });

  return thread!;
}

export async function getThread(db: Db, threadId: string) {
  return getThreadRow(db, threadId);
}

export async function searchThreads(
  db: Db,
  input: {
    projectId: string;
    state?: ThreadState;
    textQuery?: string;
  },
) {
  const conditions = [
    eq(threads.projectId, input.projectId),
    isNull(threads.archivedAt),
  ];
  if (input.state) {
    conditions.push(eq(threads.state, input.state));
  }
  const textFilter = buildThreadTextFilter(input.textQuery);
  if (textFilter) {
    conditions.push(textFilter);
  }

  return db
    .select()
    .from(threads)
    .where(and(...conditions));
}
