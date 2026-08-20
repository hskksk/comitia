import { and, eq } from "drizzle-orm";
import type { DeclarationKind } from "@comitia/shared";
import { agreements, posts, proposals, threads } from "../db/schema.js";
import type { Db, DbClient } from "../db/test-setup.js";
import { evaluateConsensus } from "./consensus.js";
import { recordEvent } from "./events.js";
import {
  InvalidTransition,
  NotFoundError,
  PermissionDenied,
} from "./errors.js";
import {
  assertProjectOwner,
  assertThreadOwner,
  assertThreadOwnerOrProjectOwner,
  getMainParticipantIds,
  getParticipant,
  getProject,
  getProposalVersion,
  getThreadRow,
  isProjectOwner,
} from "./helpers.js";
import { getThreadObjections } from "./posts.js";
import { deactivateThreadClaims } from "./work-claims.js";

type DeclarePayload = Record<string, unknown>;

async function insertDeclarationPost(
  db: Db,
  input: {
    threadId: string;
    actorId: string;
    kind: DeclarationKind;
    payload: DeclarePayload;
    body: string;
  },
) {
  const [post] = await db
    .insert(posts)
    .values({
      threadId: input.threadId,
      authorParticipantId: input.actorId,
      type: "declaration",
      body: input.body,
      declarationKind: input.kind,
      declarationPayload: input.payload,
    })
    .returning();
  return post!;
}

async function recordStateChange(
  db: Db,
  input: {
    projectId: string;
    threadId: string;
    actorId: string;
    from: string;
    to: string;
    reason: string;
  },
) {
  await recordEvent(db, {
    projectId: input.projectId,
    threadId: input.threadId,
    actorParticipantId: input.actorId,
    kind: "state_changed",
    payload: {
      from: input.from,
      to: input.to,
      reason: input.reason,
    },
  });
}

async function recordAgreement(
  db: Db,
  input: {
    projectId: string;
    threadId: string;
    actorId: string;
    proposalVersionId: string;
    outcome: "adopted" | "rejected";
    binding: boolean;
    summary: string;
  },
) {
  const [agreement] = await db
    .insert(agreements)
    .values({
      projectId: input.projectId,
      threadId: input.threadId,
      proposalVersionId: input.proposalVersionId,
      outcome: input.outcome,
      binding: input.binding,
      summary: input.summary,
    })
    .returning();

  await recordEvent(db, {
    projectId: input.projectId,
    threadId: input.threadId,
    actorParticipantId: input.actorId,
    kind: "agreement_recorded",
    payload: {
      agreementId: agreement!.id,
      outcome: input.outcome,
      binding: input.binding,
      proposalVersionId: input.proposalVersionId,
    },
  });

  return agreement!;
}

async function finalizeDecided(
  db: Db,
  input: {
    threadId: string;
    actorId: string;
    binding: boolean;
    summary: string;
  },
) {
  const thread = await getThreadRow(db, input.threadId);
  if (!thread.candidateProposalVersionId) {
    throw new InvalidTransition("候補提案版が選定されていません");
  }

  const versionInfo = await getProposalVersion(
    db,
    thread.candidateProposalVersionId,
  );

  await db
    .update(proposals)
    .set({ outcome: "adopted" })
    .where(eq(proposals.id, versionInfo.proposal.id));

  const [updatedThread] = await db
    .update(threads)
    .set({
      state: "decided",
      decidedAt: new Date(),
    })
    .where(eq(threads.id, input.threadId))
    .returning();

  await recordStateChange(db, {
    projectId: thread.projectId,
    threadId: input.threadId,
    actorId: input.actorId,
    from: thread.state,
    to: "decided",
    reason: input.summary,
  });

  const agreement = await recordAgreement(db, {
    projectId: thread.projectId,
    threadId: input.threadId,
    actorId: input.actorId,
    proposalVersionId: thread.candidateProposalVersionId,
    outcome: "adopted",
    binding: input.binding,
    summary: input.summary,
  });

  return { thread: updatedThread!, agreement };
}

/** 成立時に必須のペイロード（binding / summary）を検証する */
function requireDecisionPayload(payload: DeclarePayload): {
  binding: boolean;
  summary: string;
} {
  if (typeof payload.binding !== "boolean") {
    throw new InvalidTransition(
      "成立の宣言には binding（拘束的かどうか）の指定が必須です",
    );
  }
  if (typeof payload.summary !== "string" || !payload.summary.trim()) {
    throw new InvalidTransition("成立の宣言には summary（要旨）が必須です");
  }
  return { binding: payload.binding, summary: payload.summary };
}

/**
 * 宣言の入口。全体を 1 トランザクションで実行する。
 * 検証に失敗した宣言は、宣言投稿・イベントごとロールバックされ、痕跡を残さない。
 */
export async function declare(
  db: DbClient,
  input: {
    threadId: string;
    actorId: string;
    kind: DeclarationKind;
    payload: DeclarePayload;
  },
) {
  return db.transaction(async (tx) => declareInTx(tx, input));
}

async function declareInTx(
  db: Db,
  input: {
    threadId: string;
    actorId: string;
    kind: DeclarationKind;
    payload: DeclarePayload;
  },
) {
  if (input.kind === "resolve_objection") {
    throw new InvalidTransition(
      "異議の解消は resolveObjection() 経由で行ってください",
    );
  }

  const thread = await getThreadRow(db, input.threadId);
  const project = await getProject(db, thread.projectId);

  const declarationPost = await insertDeclarationPost(db, {
    threadId: input.threadId,
    actorId: input.actorId,
    kind: input.kind,
    payload: input.payload,
    body: `[${input.kind}]`,
  });

  await recordEvent(db, {
    projectId: thread.projectId,
    threadId: input.threadId,
    actorParticipantId: input.actorId,
    kind: "thread_declaration",
    payload: {
      declarationKind: input.kind,
      declarationPostId: declarationPost.id,
      ...input.payload,
    },
  });

  switch (input.kind) {
    case "select_candidate": {
      await assertThreadOwnerOrProjectOwner(db, input.threadId, input.actorId);
      const isTimedType =
        thread.consensusType === "unanimous" ||
        thread.consensusType === "no_objection" ||
        thread.consensusType === "silence";
      const alreadyAwaiting = isTimedType && thread.state === "awaiting_decision";
      if (thread.state !== "discussing" && !alreadyAwaiting) {
        throw new InvalidTransition(
          "候補の選定は議論中、またはこの合意種類の合意待ち中のみ可能です",
        );
      }
      const proposalVersionId = input.payload.proposalVersionId as string;
      if (!proposalVersionId) {
        throw new InvalidTransition("proposalVersionId が必須です");
      }
      await getProposalVersion(db, proposalVersionId);

      const now = new Date();
      const durationHours =
        thread.consensusType === "silence"
          ? 48
          : thread.consensusType === "no_objection"
            ? 24
            : null;

      const [updated] = await db
        .update(threads)
        .set({
          candidateProposalVersionId: proposalVersionId,
          ...(isTimedType
            ? {
                state: "awaiting_decision" as const,
                awaitingEnteredAt: now,
                timingDurationHours: durationHours,
                timingEndsAt: durationHours
                  ? new Date(now.getTime() + durationHours * 3600_000)
                  : null,
              }
            : {}),
        })
        .where(eq(threads.id, input.threadId))
        .returning();

      await recordEvent(db, {
        projectId: thread.projectId,
        threadId: input.threadId,
        actorParticipantId: input.actorId,
        kind: "candidate_selected",
        payload: { proposalVersionId },
      });

      if (isTimedType && !alreadyAwaiting) {
        await recordStateChange(db, {
          projectId: thread.projectId,
          threadId: input.threadId,
          actorId: input.actorId,
          from: thread.state,
          to: "awaiting_decision",
          reason: "候補選定により合意待ちへ",
        });
      }

      return { thread: updated!, post: declarationPost };
    }

    case "declare_rough": {
      await assertThreadOwner(db, input.threadId, input.actorId);
      if (thread.consensusType !== "rough") {
        throw new InvalidTransition("ラフ宣言は合意種類が rough のときのみ可能です");
      }
      if (thread.state !== "discussing") {
        throw new InvalidTransition("ラフ宣言は議論中のみ可能です");
      }
      if (!thread.candidateProposalVersionId) {
        throw new InvalidTransition("候補提案版が選定されていません");
      }

      const mainParticipantIds = await getMainParticipantIds(db, input.threadId);
      const objections = await getThreadObjections(db, input.threadId);
      const evaluation = evaluateConsensus({
        consensusType: "rough",
        candidateVersionId: thread.candidateProposalVersionId,
        objections: objections.map((o) => ({
          authorId: o.authorParticipantId,
          blocking: o.blocking ?? false,
          resolvedAt: o.resolvedAt,
          proposalVersionId: o.proposalVersionId!,
        })),
        mainParticipantIds,
      });

      if (!evaluation.satisfied) {
        const blockingList = objections
          .filter(
            (o) =>
              o.proposalVersionId === thread.candidateProposalVersionId &&
              o.blocking &&
              !o.resolvedAt &&
              mainParticipantIds.includes(o.authorParticipantId),
          )
          .map((o) => ({
            postId: o.id,
            authorId: o.authorParticipantId,
            body: o.body,
          }));
        throw new InvalidTransition(
          `ラフ合意の成立条件を満たしていません: ${evaluation.reasons.join("; ")}。未解消のブロッキング異議: ${JSON.stringify(blockingList)}`,
        );
      }

      if (thread.humanRequired) {
        const [updated] = await db
          .update(threads)
          .set({ state: "awaiting_decision" })
          .where(eq(threads.id, input.threadId))
          .returning();
        await recordStateChange(db, {
          projectId: thread.projectId,
          threadId: input.threadId,
          actorId: input.actorId,
          from: thread.state,
          to: "awaiting_decision",
          reason: "人間の合意が必要なため批准待ちへ",
        });
        return { thread: updated!, post: declarationPost };
      }

      const { binding, summary } = requireDecisionPayload(input.payload);
      const result = await finalizeDecided(db, {
        threadId: input.threadId,
        actorId: input.actorId,
        binding,
        summary,
      });
      return { ...result, post: declarationPost };
    }

    case "owner_decide": {
      await assertThreadOwner(db, input.threadId, input.actorId);
      if (thread.consensusType !== "owner_decision") {
        throw new InvalidTransition(
          "オーナー決定宣言は合意種類が owner_decision のときのみ可能です",
        );
      }
      if (thread.state !== "discussing") {
        throw new InvalidTransition("オーナー決定は議論中のみ可能です");
      }
      if (!thread.candidateProposalVersionId) {
        throw new InvalidTransition("候補提案版が選定されていません");
      }

      if (thread.humanRequired) {
        const [updated] = await db
          .update(threads)
          .set({ state: "awaiting_decision" })
          .where(eq(threads.id, input.threadId))
          .returning();
        await recordStateChange(db, {
          projectId: thread.projectId,
          threadId: input.threadId,
          actorId: input.actorId,
          from: thread.state,
          to: "awaiting_decision",
          reason: "人間の合意が必要なため批准待ちへ",
        });
        return { thread: updated!, post: declarationPost };
      }

      const { binding, summary } = requireDecisionPayload(input.payload);
      const result = await finalizeDecided(db, {
        threadId: input.threadId,
        actorId: input.actorId,
        binding,
        summary,
      });
      return { ...result, post: declarationPost };
    }

    case "request_ratification": {
      if (thread.consensusType !== "human_ratification") {
        throw new InvalidTransition(
          "批准依頼は合意種類が human_ratification のときのみ可能です",
        );
      }
      if (thread.state !== "discussing") {
        throw new InvalidTransition("批准依頼は議論中のみ可能です");
      }
      if (!thread.candidateProposalVersionId) {
        throw new InvalidTransition("候補提案版が選定されていません");
      }

      const [updated] = await db
        .update(threads)
        .set({ state: "awaiting_decision" })
        .where(eq(threads.id, input.threadId))
        .returning();

      await recordStateChange(db, {
        projectId: thread.projectId,
        threadId: input.threadId,
        actorId: input.actorId,
        from: thread.state,
        to: "awaiting_decision",
        reason: "人間批准待ち",
      });

      return { thread: updated!, post: declarationPost };
    }

    case "ratify": {
      if (thread.state !== "awaiting_decision") {
        throw new InvalidTransition(
          "批准は判断待ち状態のときのみ可能です",
        );
      }
      if (input.actorId !== project.ownerParticipantId) {
        throw new PermissionDenied("批准者はプロジェクトオーナーです");
      }
      const actor = await getParticipant(db, input.actorId);
      if (actor.kind !== "human") {
        throw new PermissionDenied("批准者は人間である必要があります");
      }
      if (!thread.candidateProposalVersionId) {
        throw new InvalidTransition("候補提案版が選定されていません");
      }
      const { proposal } = await getProposalVersion(
        db,
        thread.candidateProposalVersionId,
      );
      if (proposal.authorParticipantId === input.actorId) {
        throw new PermissionDenied(
          "候補提案版の著者は自分の版を批准できません",
        );
      }

      const { binding, summary } = requireDecisionPayload(input.payload);
      const result = await finalizeDecided(db, {
        threadId: input.threadId,
        actorId: input.actorId,
        binding,
        summary,
      });
      return { ...result, post: declarationPost };
    }

    case "send_back": {
      if (thread.state !== "awaiting_decision") {
        throw new InvalidTransition(
          "差し戻しは判断待ち状態のときのみ可能です",
        );
      }
      const isProjOwner = await isProjectOwner(
        db,
        thread.projectId,
        input.actorId,
      );
      if (!isProjOwner) {
        throw new PermissionDenied(
          "差し戻しはプロジェクトオーナーのみ実行できます",
        );
      }

      const [updated] = await db
        .update(threads)
        .set({ state: "discussing" })
        .where(eq(threads.id, input.threadId))
        .returning();

      await recordStateChange(db, {
        projectId: thread.projectId,
        threadId: input.threadId,
        actorId: input.actorId,
        from: thread.state,
        to: "discussing",
        reason: (input.payload.reason as string) ?? "差し戻し",
      });

      return { thread: updated!, post: declarationPost };
    }

    case "reject_thread": {
      await assertThreadOwnerOrProjectOwner(db, input.threadId, input.actorId);
      if (thread.state !== "discussing" && thread.state !== "awaiting_decision") {
        throw new InvalidTransition(
          "不採用にできるのは議論中または判断待ちのスレッドのみです",
        );
      }

      if (thread.candidateProposalVersionId) {
        const versionInfo = await getProposalVersion(
          db,
          thread.candidateProposalVersionId,
        );
        await db
          .update(proposals)
          .set({ outcome: "rejected" })
          .where(eq(proposals.id, versionInfo.proposal.id));
      }

      const [updated] = await db
        .update(threads)
        .set({ state: "rejected" })
        .where(eq(threads.id, input.threadId))
        .returning();

      await recordStateChange(db, {
        projectId: thread.projectId,
        threadId: input.threadId,
        actorId: input.actorId,
        from: thread.state,
        to: "rejected",
        reason: (input.payload.summary as string) ?? "不採用",
      });

      await deactivateThreadClaims(db, {
        threadId: input.threadId,
        actorId: input.actorId,
      });

      let agreement;
      if (input.payload.recordAsAgreement) {
        if (!thread.candidateProposalVersionId) {
          throw new InvalidTransition(
            "合意物として記録するには候補提案版が必要です",
          );
        }
        agreement = await recordAgreement(db, {
          projectId: thread.projectId,
          threadId: input.threadId,
          actorId: input.actorId,
          proposalVersionId: thread.candidateProposalVersionId,
          outcome: "rejected",
          binding: (input.payload.binding as boolean) ?? false,
          summary: (input.payload.summary as string) ?? "不採用",
        });
      }

      return { thread: updated!, post: declarationPost, agreement };
    }

    case "complete_thread": {
      if (thread.type === "brainstorm") {
        if (thread.state !== "discussing") {
          throw new InvalidTransition(
            "ブレストの完了は議論中からのみ可能です",
          );
        }
      } else if (thread.state !== "decided") {
        throw new InvalidTransition(
          "完了は決定済み状態からのみ可能です",
        );
      }

      const [updated] = await db
        .update(threads)
        .set({ state: "completed", closedAt: new Date() })
        .where(eq(threads.id, input.threadId))
        .returning();

      await recordStateChange(db, {
        projectId: thread.projectId,
        threadId: input.threadId,
        actorId: input.actorId,
        from: thread.state,
        to: "completed",
        reason: "スレッド完了",
      });

      await deactivateThreadClaims(db, {
        threadId: input.threadId,
        actorId: input.actorId,
      });

      return { thread: updated!, post: declarationPost };
    }

    case "extend_window": {
      await assertThreadOwner(db, input.threadId, input.actorId);
      if (!thread.awaitingEnteredAt) {
        throw new InvalidTransition("合意待ちではありません");
      }
      const hours = input.payload.hours as number;
      if (typeof hours !== "number" || !(hours > 0)) {
        throw new InvalidTransition("hours は正の数が必須です");
      }
      const newEndsAt = new Date(
        thread.awaitingEnteredAt.getTime() + hours * 3600_000,
      );
      const [updated] = await db
        .update(threads)
        .set({ timingDurationHours: hours, timingEndsAt: newEndsAt })
        .where(eq(threads.id, input.threadId))
        .returning();
      return { thread: updated!, post: declarationPost };
    }

    case "shorten_window": {
      await assertProjectOwner(db, thread.projectId, input.actorId);
      if (!thread.awaitingEnteredAt) {
        throw new InvalidTransition("合意待ちではありません");
      }
      const hours = input.payload.hours as number;
      if (typeof hours !== "number" || !(hours > 0)) {
        throw new InvalidTransition("hours は正の数が必須です");
      }
      const newEndsAt = new Date(
        thread.awaitingEnteredAt.getTime() + hours * 3600_000,
      );
      if (thread.timingEndsAt && newEndsAt.getTime() >= thread.timingEndsAt.getTime()) {
        throw new InvalidTransition("短縮は現在の期限より手前にしてください");
      }
      const [updated] = await db
        .update(threads)
        .set({ timingDurationHours: hours, timingEndsAt: newEndsAt })
        .where(eq(threads.id, input.threadId))
        .returning();
      return { thread: updated!, post: declarationPost };
    }

    case "clock_satisfy": {
      const actor = await getParticipant(db, input.actorId);
      if (actor.kind !== "system") {
        throw new PermissionDenied("clock_satisfy はシステム参加者のみ実行できます");
      }
      const { binding, summary } = requireDecisionPayload(input.payload);
      const result = await finalizeDecided(db, {
        threadId: input.threadId,
        actorId: input.actorId,
        binding,
        summary,
      });
      return { ...result, post: declarationPost };
    }

    default:
      throw new InvalidTransition(`未対応の宣言種類です: ${input.kind}`);
  }
}