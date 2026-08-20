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

describe("evaluateConsensus (unanimous)", () => {
  it("未表明が1人でも不成立", () => {
    const result = evaluateConsensus({
      consensusType: "unanimous",
      candidateVersionId: candidateId,
      objections: [],
      mainParticipantIds: [mainA, mainB],
      mainParticipants: [
        { id: mainA, kind: "human", engine: null },
        { id: mainB, kind: "agent", engine: "claude-code" },
      ],
      approvals: [{ participantId: mainA, proposalVersionId: candidateId }],
    });
    expect(result.satisfied).toBe(false);
    expect(result.reasons.some((r) => r.includes(mainB))).toBe(true);
  });

  it("全員が承認していれば成立", () => {
    const result = evaluateConsensus({
      consensusType: "unanimous",
      candidateVersionId: candidateId,
      objections: [],
      mainParticipantIds: [mainA, mainB],
      mainParticipants: [
        { id: mainA, kind: "human", engine: null },
        { id: mainB, kind: "agent", engine: "claude-code" },
      ],
      approvals: [
        { participantId: mainA, proposalVersionId: candidateId },
        { participantId: mainB, proposalVersionId: candidateId },
      ],
    });
    expect(result.satisfied).toBe(true);
  });

  it("collapse_same_engine では同一エンジンの承認も個別の主な参加者としてカウントする", () => {
    const agentC = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const result = evaluateConsensus({
      consensusType: "unanimous",
      candidateVersionId: candidateId,
      objections: [],
      mainParticipantIds: [mainB, agentC],
      mainParticipants: [
        { id: mainB, kind: "agent", engine: "claude-code" },
        { id: agentC, kind: "agent", engine: "claude-code" },
      ],
      approvals: [
        { participantId: mainB, proposalVersionId: candidateId },
        { participantId: agentC, proposalVersionId: candidateId },
      ],
      engineDiversity: "collapse_same_engine",
    });
    expect(result.satisfied).toBe(true);
  });

  it("require_other_engine では承認エンジンが1種類のみだと不成立理由に含まれる", () => {
    const agentC = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const result = evaluateConsensus({
      consensusType: "unanimous",
      candidateVersionId: candidateId,
      objections: [],
      mainParticipantIds: [mainB, agentC],
      mainParticipants: [
        { id: mainB, kind: "agent", engine: "claude-code" },
        { id: agentC, kind: "agent", engine: "claude-code" },
      ],
      approvals: [
        { participantId: mainB, proposalVersionId: candidateId },
        { participantId: agentC, proposalVersionId: candidateId },
      ],
      engineDiversity: "require_other_engine",
    });
    expect(result.reasons.some((r) => r.includes("require_other_engine"))).toBe(
      true,
    );
  });
});

describe("evaluateConsensus (no_objection / silence)", () => {
  const now = new Date("2026-08-16T12:00:00Z");
  const awaitingEnteredAt = new Date("2026-08-14T12:00:00Z");
  const timingEndsAt = new Date("2026-08-16T12:00:00Z");

  it("期限前は不成立", () => {
    const result = evaluateConsensus({
      consensusType: "no_objection",
      candidateVersionId: candidateId,
      objections: [],
      mainParticipantIds: [mainA],
      mainParticipants: [{ id: mainA, kind: "human", engine: null }],
      now: new Date("2026-08-15T00:00:00Z"),
      awaitingEnteredAt,
      timingEndsAt,
      sessionsAfterAwaiting: [],
    });
    expect(result.satisfied).toBe(false);
  });

  it("エージェント主な参加者がセッションを起こしていなければ期限到来後も不成立", () => {
    const result = evaluateConsensus({
      consensusType: "silence",
      candidateVersionId: candidateId,
      objections: [],
      mainParticipantIds: [mainA],
      mainParticipants: [{ id: mainA, kind: "agent", engine: "claude-code" }],
      now,
      awaitingEnteredAt,
      timingEndsAt,
      sessionsAfterAwaiting: [],
    });
    expect(result.satisfied).toBe(false);
  });

  it("人間だけが主な参加者なら、期限到来だけで成立する", () => {
    const result = evaluateConsensus({
      consensusType: "silence",
      candidateVersionId: candidateId,
      objections: [],
      mainParticipantIds: [mainA],
      mainParticipants: [{ id: mainA, kind: "human", engine: null }],
      now,
      awaitingEnteredAt,
      timingEndsAt,
      sessionsAfterAwaiting: [],
    });
    expect(result.satisfied).toBe(true);
  });

  it("非ブロッキング異議は no_objection を止めない", () => {
    const result = evaluateConsensus({
      consensusType: "no_objection",
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
      mainParticipants: [{ id: mainA, kind: "human", engine: null }],
      now,
      awaitingEnteredAt,
      timingEndsAt,
      sessionsAfterAwaiting: [],
    });
    expect(result.satisfied).toBe(true);
  });

  it("エージェントが期限到来後にセッションを起こしていれば成立する", () => {
    const result = evaluateConsensus({
      consensusType: "no_objection",
      candidateVersionId: candidateId,
      objections: [],
      mainParticipantIds: [mainA, mainB],
      mainParticipants: [
        { id: mainA, kind: "human", engine: null },
        { id: mainB, kind: "agent", engine: "claude-code" },
      ],
      now,
      awaitingEnteredAt,
      timingEndsAt,
      sessionsAfterAwaiting: [mainB],
    });
    expect(result.satisfied).toBe(true);
  });
});
