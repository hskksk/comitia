import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { getBriefing } from "./briefing.js";
import { completeGoal, openOrGetSession, setGoals } from "./sessions.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";
import { adoptDefaultFounding } from "./founding.js";

describe("session goals", () => {
  it("set_goals then complete_goal; briefing shows incomplete then completed", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const agent = await registerParticipant(db, {
      kind: "agent",
      displayName: "ソウ",
      ownerParticipantId: owner.id,
    });
    const project = await createProject(db, {
      name: "comitia-web",
      ownerParticipantId: owner.id,
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });

    const session = await openOrGetSession(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    await setGoals(db, {
      sessionId: session.id,
      texts: ["README typo を直す", "報告する"],
    });

    const briefingPending = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(briefingPending.situation.incomplete_goals).toHaveLength(2);
    expect(briefingPending.situation.incomplete_goals.every((g) => g.status === "pending")).toBe(
      true,
    );

    const goalId = briefingPending.situation.incomplete_goals[0]!.id;
    await completeGoal(db, { sessionId: session.id, goalId });

    const briefingDone = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(briefingDone.situation.incomplete_goals).toHaveLength(1);
    expect(
      briefingDone.situation.incomplete_goals.some((g) => g.id === goalId),
    ).toBe(false);
  });
});
