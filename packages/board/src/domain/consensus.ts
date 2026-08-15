import type { ConsensusType } from "@comitia/shared";

export type ObjectionInput = {
  authorId: string;
  blocking: boolean;
  resolvedAt: Date | null;
  proposalVersionId: string;
};

export type EvaluateConsensusInput = {
  consensusType: ConsensusType;
  candidateVersionId: string | null;
  objections: ObjectionInput[];
  mainParticipantIds: string[];
};

export type EvaluateConsensusResult = {
  satisfied: boolean;
  reasons: string[];
};

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
      const relevant = input.objections.filter(
        (o) => o.proposalVersionId === input.candidateVersionId,
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

      const blockingUnresolved = relevant.filter(
        (o) =>
          mainSet.has(o.authorId) &&
          o.blocking &&
          o.resolvedAt === null,
      );

      if (blockingUnresolved.length > 0) {
        return {
          satisfied: false,
          reasons,
        };
      }

      return {
        satisfied: true,
        reasons: reasons.length > 0 ? reasons : ["ラフ合意の条件を満たしました"],
      };
    }

    default:
      return { satisfied: false, reasons: ["未対応の合意種類です"] };
  }
}
