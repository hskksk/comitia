import "../test/helpers.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentCredentials, githubOauthStates, participants, projects } from "../db/schema.js";
import { db } from "../test/helpers.js";
import { seedOwnerAgentProject } from "../test/human-fixtures.js";
import { createBoardApp } from "./app.js";
import { createFakeGitHubClient } from "../github/fake-client.js";
import { hashToken, authenticateToken } from "../domain/credentials.js";

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

  it("keeps the previous human token valid after OAuth login", async () => {
    const board = app();
    const state = "oauth-state-keep-old";
    await db.insert(githubOauthStates).values({
      state,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { owner } = await seedOwnerAgentProject(db);
    const previousToken = "owner-token-before-oauth";
    await db.insert(agentCredentials).values({
      participantId: owner.id,
      projectId: null,
      tokenHash: hashToken(previousToken),
    });

    const res = await board.request(
      `/v1/auth/github/callback?code=good-code&state=${state}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    const newToken = location.searchParams.get("token");
    expect(newToken).toMatch(/^comt_/);

    expect(await authenticateToken(db, previousToken)).toMatchObject({
      participant: { id: owner.id },
    });
    expect(await authenticateToken(db, newToken!)).toMatchObject({
      participant: { id: owner.id },
    });
  });

  it("creates a second human for a different GitHub user", async () => {
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
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login/callback?token=");
    const humans = await db.select().from(participants);
    expect(humans.filter((row) => row.kind === "human")).toHaveLength(2);
  });

  it("rejects invalid oauth state", async () => {
    const res = await app().request(
      "/v1/auth/github/callback?code=good-code&state=missing",
    );
    expect(res.status).toBe(400);
  });

  it("uses BOARD_PUBLIC_URL for GitHub redirect_uri and returns to Vite", async () => {
    const board = createBoardApp({
      db,
      github,
      githubPublicBaseUrl: "http://localhost:8787",
      githubOAuth: {
        enabled: true,
        appSlug: "comitia-board",
        clientId: "client-id",
      },
    });
    await seedOwnerAgentProject(db);
    const start = await board.request(
      "http://localhost:5173/v1/auth/github?return_origin=http://localhost:5173",
    );
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get("location") ?? "");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8787/v1/auth/github/callback",
    );
    const state = authorize.searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await board.request(
      `http://localhost:8787/v1/auth/github/callback?code=good-code&state=${state}`,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toMatch(
      /^http:\/\/localhost:5173\/login\/callback\?token=/,
    );
  });

  it("ignores an untrusted return_origin", async () => {
    const board = createBoardApp({
      db,
      github,
      githubPublicBaseUrl: "http://localhost:8787",
      githubOAuth: {
        enabled: true,
        clientId: "client-id",
      },
    });
    await seedOwnerAgentProject(db);
    const start = await board.request(
      "http://localhost:5173/v1/auth/github?return_origin=https://evil.example",
    );
    const state = new URL(start.headers.get("location") ?? "").searchParams.get(
      "state",
    );
    const callback = await board.request(
      `http://localhost:8787/v1/auth/github/callback?code=good-code&state=${state}`,
    );
    expect(callback.headers.get("location")).toMatch(
      /^http:\/\/localhost:8787\/login\/callback\?token=/,
    );
  });
});

describe("GitHub installation setup", () => {
  it("returns install url as json", async () => {
    const board = app();
    const { owner, project } = await seedOwnerAgentProject(db);
    const token = "owner-token";
    await db.insert(agentCredentials).values({
      participantId: owner.id,
      projectId: project.id,
      tokenHash: hashToken(token),
    });
    const res = await board.request("/v1/github/install", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://github.com/apps/comitia-board/installations/new",
    });
  });

  it("connects an existing installation that covers the project repo", async () => {
    const githubInstalled = createFakeGitHubClient({
      installationRepos: {
        "inst-42": [
          { owner: "hskksk", repo: "prism-data-labs-agent" },
          { owner: "hskksk", repo: "comitia" },
        ],
      },
    });
    const board = createBoardApp({
      db,
      github: githubInstalled,
      githubOAuth: {
        enabled: true,
        appSlug: "comitia-board",
        clientId: "client-id",
      },
    });
    const { owner, project } = await seedOwnerAgentProject(db);
    await db
      .update(projects)
      .set({ repoUrl: "https://github.com/hskksk/comitia" })
      .where(eq(projects.id, project.id));
    const token = "owner-token";
    await db.insert(agentCredentials).values({
      participantId: owner.id,
      projectId: project.id,
      tokenHash: hashToken(token),
    });
    const res = await board.request("/v1/github/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true });
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id));
    expect(row?.githubInstallationId).toBe("inst-42");
    expect(row?.githubOwner).toBe("hskksk");
    expect(row?.githubRepo).toBe("comitia");
  });

  it("returns GitHub install url when no installation covers the repo", async () => {
    const githubMissing = createFakeGitHubClient({
      installationRepos: {},
    });
    const board = createBoardApp({
      db,
      github: githubMissing,
      githubOAuth: {
        enabled: true,
        appSlug: "comitia-board",
        clientId: "client-id",
      },
    });
    const { owner, project } = await seedOwnerAgentProject(db);
    const token = "owner-token";
    await db.insert(agentCredentials).values({
      participantId: owner.id,
      projectId: project.id,
      tokenHash: hashToken(token),
    });
    const res = await board.request("/v1/github/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: false,
      url: "https://github.com/apps/comitia-board/installations/new",
    });
  });
});
