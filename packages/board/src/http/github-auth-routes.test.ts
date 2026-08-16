import "../test/helpers.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentCredentials, githubOauthStates, participants } from "../db/schema.js";
import { db } from "../test/helpers.js";
import { seedOwnerAgentProject } from "../test/human-fixtures.js";
import { createBoardApp } from "./app.js";
import { createFakeGitHubClient } from "../github/fake-client.js";

const github = createFakeGitHubClient({
  oauthCodes: { "good-code": { accessToken: "user-token-1" } },
  users: {
    "user-token-1": { id: "1001", login: "hskksk" },
    "user-token-2": { id: "1002", login: "other" },
  },
  installationRepos: {
    "inst-42": [{ owner: "hskksk", repo: "comitia" }],
  },
});

function app() {
  return createBoardApp({
    db,
    github,
    githubOAuth: {
      enabled: true,
      appSlug: "comitia-board",
      clientId: "client-id",
    },
  });
}

describe("GitHub OAuth", () => {
  it("exposes auth config", async () => {
    const res = await app().request("/v1/auth/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ githubOAuth: true });
  });

  it("binds the first GitHub user to the owner", async () => {
    const board = app();
    const state = "oauth-state-1";
    const expiresAt = new Date(Date.now() + 60_000);
    await db.insert(githubOauthStates).values({ state, expiresAt });
    const { owner } = await seedOwnerAgentProject(db);

    const res = await board.request(
      `/v1/auth/github/callback?code=good-code&state=${state}`,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login/callback?token=");

    const [human] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, owner.id));
    expect(human?.githubUserId).toBe("1001");
    expect(human?.githubLogin).toBe("hskksk");
  });

  it("rejects a second GitHub user", async () => {
    const board = app();
    const { owner } = await seedOwnerAgentProject(db);
    await db
      .update(participants)
      .set({ githubUserId: "1001", githubLogin: "hskksk" })
      .where(eq(participants.id, owner.id));

    const state = "oauth-state-2";
    await db.insert(githubOauthStates).values({
      state,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const githubOther = createFakeGitHubClient({
      oauthCodes: { "other-code": { accessToken: "user-token-2" } },
      users: {
        "user-token-2": { id: "1002", login: "other" },
      },
    });
    const otherApp = createBoardApp({
      db,
      github: githubOther,
      githubOAuth: { enabled: true, clientId: "client-id" },
    });
    const res = await otherApp.request(
      `/v1/auth/github/callback?code=other-code&state=${state}`,
    );
    expect(res.status).toBe(403);
  });

  it("rejects invalid oauth state", async () => {
    const res = await app().request(
      "/v1/auth/github/callback?code=good-code&state=missing",
    );
    expect(res.status).toBe(400);
  });
});

describe("GitHub installation setup", () => {
  it("redirects owner to app install page", async () => {
    const board = app();
    const { owner, project } = await seedOwnerAgentProject(db);
    const token = "owner-token";
    await db.insert(agentCredentials).values({
      participantId: owner.id,
      projectId: project.id,
      tokenHash: (await import("../domain/credentials.js")).hashToken(token),
    });
    const res = await board.request("/v1/github/install", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(
      "github.com/apps/comitia-board/installations/new",
    );
  });
});
