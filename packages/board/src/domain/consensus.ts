import type { ConsensusType, EngineDiversity, ParticipantKind } from "@comitia/shared";

export type ObjectionInput = {
  authorId: string;
  blocking: boolean;
  resolvedAt: Date | null;
  proposalVersionId: string;
};

export type ApprovalInput = {
  participantId: string;
  proposalVersionId: string;
};

export type MainParticipant = {
  id: string;
  kind: ParticipantKind;
  engine: string | null;
};

export type EvaluateConsensusInput = {
  consensusType: ConsensusType;
  candidateVersionId: string | null;
  objections: ObjectionInput[];
  mainParticipantIds: string[];
  approvals?: ApprovalInput[];
  now?: Date;
  awaitingEnteredAt?: Date | null;
  timingEndsAt?: Date | null;
  sessionsAfterAwaiting?: string[];
  mainParticipants?: MainParticipant[];
  engineDiversity?: EngineDiversity;
};

export type EvaluateConsensusResult = {
  satisfied: boolean;
  reasons: string[];
};

function hasUnresolvedBlockingObjection(
  objections: ObjectionInput[],
  candidateVersionId: string,
  mainSet: Set<string>,
  reasons: string[],
): boolean {
  const relevant = objections.filter(
    (o) => o.proposalVersionId === candidateVersionId,
  );

  for (const objection of relevant) {
    if (!mainSet.has(objection.authorId)) {
      reasons.push(
        `任意参加者（${objection.authorId}）の異議は成立判定に含めません`,
      );
      continue;
    }
    if (!objection.blocking) {
      reasons.push(
        `主な参加者（${objection.authorId}）の非ブロッキング異議は止めません`,
      );
      continue;
    }
    if (objection.resolvedAt) {
      continue;
    }
    reasons.push(
      `主な参加者（${objection.authorId}）の未解消ブロッキング異議があります`,
    );
  }

  return relevant.some(
    (o) => mainSet.has(o.authorId) && o.blocking && o.resolvedAt === null,
  );
}

function evaluateUnanimous(
  input: EvaluateConsensusInput,
  candidateVersionId: string,
  reasons: string[],
): EvaluateConsensusResult {
  const mains = (input.mainParticipants ?? []).filter((p) => p.kind !== "system");
  const approvals = (input.approvals ?? []).filter(
    (a) => a.proposalVersionId === candidateVersionId,
  );
  const approvedByParticipant = new Set(approvals.map((a) => a.participantId));

  const engineDiversity = input.engineDiversity ?? "off";
  if (engineDiversity !== "off") {
    const approvedEngines = new Set(
      approvals
        .map((a) => mains.find((m) => m.id === a.participantId))
        .filter((m): m is MainParticipant => m !== undefined)
        .map((m) => m.engine ?? m.id),
    );
    if (engineDiversity === "require_other_engine" && approvedEngines.size < 2) {
      reasons.push("require_other_engine: 承認に使ったエンジンが2つ未満です");
    }
  }

  const missing = mains.filter((p) => !approvedByParticipant.has(p.id));
  if (missing.length > 0) {
    for (const p of missing) {
      reasons.push(`主な参加者（${p.id}）が未表明です`);
    }
    return { satisfied: false, reasons };
  }

  return {
    satisfied: true,
    reasons: reasons.length > 0 ? reasons : ["全員が承認しました"],
  };
}

function evaluateTimedType(
  input: EvaluateConsensusInput,
  candidateVersionId: string,
  reasons: string[],
): EvaluateConsensusResult {
  const mainSet = new Set(input.mainParticipantIds);
  const blockingUnresolved = hasUnresolvedBlockingObjection(
    input.objections,
    candidateVersionId,
    mainSet,
    reasons,
  );
  if (blockingUnresolved) {
    return { satisfied: false, reasons };
  }

  const now = input.now;
  const timingEndsAt = input.timingEndsAt;
  if (!now || !timingEndsAt || now.getTime() < timingEndsAt.getTime()) {
    reasons.push("期限にまだ到達していません");
    return { satisfied: false, reasons };
  }

  const mains = input.mainParticipants ?? [];
  const sessionsAfterAwaiting = new Set(input.sessionsAfterAwaiting ?? []);
  const sleepingAgents = mains.filter(
    (p) => p.kind === "agent" && !sessionsAfterAwaiting.has(p.id),
  );
  if (sleepingAgents.length > 0) {
    for (const p of sleepingAgents) {
      reasons.push(
        `主な参加者（${p.id}）は合意待ち開始後にセッションが起きていません`,
      );
    }
    return { satisfied: false, reasons };
  }

  return {
    satisfied: true,
    reasons: reasons.length > 0 ? reasons : ["期限が到来し、条件を満たしました"],
  };
}

export function evaluateConsensus(
  input: EvaluateConsensusInput,
): EvaluateConsensusResult {
  const reasons: string[] = [];
  const mainSet = new Set(input.mainParticipantIds);

  if (!input.candidateVersionId) {
    return { satisfied: false, reasons: ["候補提案版が選定されていません"] };
  }

  switch (input.consensusType) {
    case "owner_decision":
      return { satisfied: true, reasons: ["オーナー決定は候補があれば成立"] };

    case "human_ratification":
      return {
        satisfied: false,
        reasons: ["人間批准は批准行為でのみ成立します"],
      };

    case "rough": {
      const blockingUnresolved = hasUnresolvedBlockingObjection(
        input.objections,
        input.candidateVersionId,
        mainSet,
        reasons,
      );

      if (blockingUnresolved) {
        return { satisfied: false, reasons };
      }

      return {
        satisfied: true,
        reasons: reasons.length > 0 ? reasons : ["ラフ合意の条件を満たしました"],
      };
    }

    case "unanimous":
      return evaluateUnanimous(input, input.candidateVersionId, reasons);

    case "no_objection":
    case "silence":
      return evaluateTimedType(input, input.candidateVersionId, reasons);

    default:
      return { satisfied: false, reasons: ["未対応の合意種類です"] };
  }
}
