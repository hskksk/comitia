import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { PERSONALITY_MAX_LENGTH } from "@comitia/shared";
import { db } from "../test/helpers.js";
import { createBoardApp } from "./app.js";
import { getBriefing } from "../domain/briefing.js";

async function bootstrapWithPersonality() {
  const app = createBoardApp({ db });
  const initRes = await app.request("/v1/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerDisplayName: "ハル",
      projectName: "comitia",
    }),
  });
  const initBody = (await initRes.json()) as {
    ownerId: string;
    projectId: string;
    ownerToken: string;
  };
  const ownerHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${initBody.ownerToken}`,
  };
  const regRes = await app.request("/v1/agents", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      displayName: "ミカ",
      engine: "claude-code",
      personality: "慎重にリスクを先に出す",
    }),
  });
  expect(regRes.status).toBe(201);
  const agentBody = (await regRes.json()) as {
    agentId: string;
    agentToken: string;
  };
  return { app, initBody, ownerHeaders, agentBody };
}

describe("M15 personality", () => {
  it("puts the same attitude on GET /v1/me and get_briefing.you", async () => {
    const { app, agentBody } = await bootstrapWithPersonality();
    const me = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${agentBody.agentToken}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      participant: { personality: string | null };
    };
    expect(meBody.participant.personality).toBe("慎重にリスクを先に出す");

    const briefing = await getBriefing(db, {
      participantId: agentBody.agentId,
    });
    expect(briefing.you).toMatchObject({
      personality: "慎重にリスクを先に出す",
    });
  });

  it("lists personality on members and owned agents", async () => {
    const { app, initBody, ownerHeaders, agentBody } = await bootstrapWithPersonality();
    const members = await app.request(
      `/v1/projects/${initBody.projectId}/members`,
      { headers: ownerHeaders },
    );
    expect(members.status).toBe(200);
    const memberBody = (await members.json()) as {
      items: Array<{ id: string; personality: string | null }>;
    };
    expect(
      memberBody.items.find((row) => row.id === agentBody.agentId)?.personality,
    ).toBe("慎重にリスクを先に出す");

    const owned = await app.request("/v1/me/agents", { headers: ownerHeaders });
    expect(owned.status).toBe(200);
    const ownedBody = (await owned.json()) as {
      items: Array<{ id: string; personality: string | null }>;
    };
    expect(ownedBody.items[0]?.personality).toBe("慎重にリスクを先に出す");
  });

  it("lets the owner clear personality and rejects over-length and self-service", async () => {
    const { app, ownerHeaders, agentBody } = await bootstrapWithPersonality();

    const tooLong = await app.request(`/v1/me/agents/${agentBody.agentId}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({
        personality: "あ".repeat(PERSONALITY_MAX_LENGTH + 1),
      }),
    });
    expect(tooLong.status).toBe(400);

    const cleared = await app.request(`/v1/me/agents/${agentBody.agentId}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ personality: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ personality: null });

    const self = await app.request("/v1/me", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({ personality: "自分で変える" }),
    });
    expect(self.status).toBe(403);

    const humanSelf = await app.request("/v1/me", {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({
        displayName: "ハル",
        personality: "人間に態度",
      }),
    });
    expect(humanSelf.status).toBe(403);
  });

  it("omits briefing personality when unset", async () => {
    const app = createBoardApp({ db });
    const initRes = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
      }),
    });
    const initBody = (await initRes.json()) as { ownerToken: string };
    const regRes = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${initBody.ownerToken}`,
      },
      body: JSON.stringify({
        displayName: "ミカ",
        engine: "claude-code",
      }),
    });
    const agentBody = (await regRes.json()) as { agentId: string };
    const briefing = await getBriefing(db, {
      participantId: agentBody.agentId,
    });
    expect(briefing.you).not.toHaveProperty("personality");
  });
});
