import { describe, expect, it } from "vitest";
import { evaluateConsensus } from "../domain/consensus.js";

const candidateId = "11111111-1111-1111-1111-111111111111";
const mainA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const mainB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const other = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("evaluateConsensus (rough)", () => {
  it("候補がなければ不成立", () => {
    const result = evaluateConsensus({
      consensusType: "rough",
      candidateVersionId: null,
      objections: [],
      mainParticipantIds: [mainA],
    });
    expect(result.satisfied).toBe(false);
  });

  it("未解消のブロッキング異議があると不成立", () => {
    const result = evaluateConsensus({
      consensusType: "rough",
      candidateVersionId: candidateId,
      objections: [
        {
          authorId: mainA,
          blocking: true,
          resolvedAt: null,
          proposalVersionId: candidateId,
        },
      ],
      mainParticipantIds: [mainA, mainB],
    });
    expect(result.satisfied).toBe(false);
    expect(result.reasons.some((r) => r.includes("ブロッキング"))).toBe(true);
  });

  it("非ブロッキング異議は止めない", () => {
    const result = evaluateConsensus({
      consensusType: "rough",
      candidateVersionId: candidateId,
      objections: [
        {
          authorId: mainA,
          blocking: false,
          resolvedAt: null,
          proposalVersionId: candidateId,
        },
      ],
      mainParticipantIds: [mainA],
    });
    expect(result.satisfied).toBe(true);
  });

  it("解消済みブロッキング異議は数えない", () => {
    const result = evaluateConsensus({
      consensusType: "rough",
      candidateVersionId: candidateId,
      objections: [
        {
          authorId: mainA,
          blocking: true,
          resolvedAt: new Date(),
          proposalVersionId: candidateId,
        },
      ],
      mainParticipantIds: [mainA],
    });
    expect(result.satisfied).toBe(true);
  });

  it("任意参加者のブロッキング異議は数えない", () => {
    const result = evaluateConsensus({
      consensusType: "rough",
      candidateVersionId: candidateId,
      objections: [
        {
          authorId: other,
          blocking: true,
          resolvedAt: null,
          proposalVersionId: candidateId,
        },
      ],
      mainParticipantIds: [mainA],
    });
    expect(result.satisfied).toBe(true);
    expect(result.reasons.some((r) => r.includes("任意参加者"))).toBe(true);
  });

  it("別版への異議は数えない", () => {
    const result = evaluateConsensus({
      consensusType: "rough",
      candidateVersionId: candidateId,
      objections: [
        {
          authorId: mainA,
          blocking: true,
          resolvedAt: null,
          proposalVersionId: "22222222-2222-2222-2222-222222222222",
        },
      ],
      mainParticipantIds: [mainA],
    });
    expect(result.satisfied).toBe(true);
  });

  it("owner_decision は候補があれば成立", () => {
    const result = evaluateConsensus({
      consensusType: "owner_decision",
      candidateVersionId: candidateId,
      objections: [
        {
          authorId: mainA,
          blocking: true,
          resolvedAt: null,
          proposalVersionId: candidateId,
        },
      ],
      mainParticipantIds: [mainA],
    });
    expect(result.satisfied).toBe(true);
  });

  it("human_ratification は常に不成立", () => {
    const result = evaluateConsensus({
      consensusType: "human_ratification",
      candidateVersionId: candidateId,
      objections: [],
      mainParticipantIds: [mainA],
    });
    expect(result.satisfied).toBe(false);
  });
});
