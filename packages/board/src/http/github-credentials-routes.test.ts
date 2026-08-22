import "../test/helpers.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AGENT_GITHUB_TOKEN_PERMISSIONS } from "../github/types.js";
import { createFakeGitHubClient } from "../github/fake-client.js";
import { addMembership } from "../domain/memberships.js";
import { createProject } from "../domain/projects.js";
import { projects } from "../db/schema.js";
import { db } from "../test/helpers.js";
import { createBoardApp } from "./app.js";

async function bootstrapOwnerAndAgent(
  app: ReturnType<typeof createBoardApp>,
  options?: { repoUrl?: string },
) {
  const initRes = await app.request("/v1/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerDisplayName: "ハル",
      projectName: "comitia",
      repoUrl: options?.repoUrl,
    }),
  });
  expect(initRes.status).toBe(201);
  const initBody = (await initRes.json()) as {
    ownerId: string;
    projectId: string;
    ownerToken: string;
  };

  const regRes = await app.request("/v1/agents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${initBody.ownerToken}`,
    },
    body: JSON.stringify({ displayName: "ミカ", engine: "claude-code" }),
  });
  expect(regRes.status).toBe(201);
  const agentBody = (await regRes.json()) as {
    agentId: string;
    projectId: string;
    agentToken: string;
  };
  return { initBody, agentBody };
}

describe("POST /v1/me/github-credentials", () => {
  it("mints a downscoped installation token for the project repo", async () => {
    const github = createFakeGitHubClient({
      installationRepos: {
        "inst-1": [{ owner: "hskksk", repo: "comitia" }],
      },
    });
    const app = createBoardApp({ db, github });
    const { initBody, agentBody } = await bootstrapOwnerAndAgent(app, {
      repoUrl: "https://github.com/hskksk/comitia",
    });
    await db
      .update(projects)
      .set({
        githubInstallationId: "inst-1",
        githubOwner: "hskksk",
        githubRepo: "comitia",
      })
      .where(eq(projects.id, initBody.projectId));

    const res = await app.request("/v1/me/github-credentials", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      expiresAt: string;
      owner: string;
      repo: string;
      repoUrl: string;
    };
    expect(body).toMatchObject({
      token: "ghs_fake_inst-1_hskksk_comitia",
      owner: "hskksk",
      repo: "comitia",
      repoUrl: "https://github.com/hskksk/comitia",
    });
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(github.mintCalls).toEqual([
      {
        installationId: "inst-1",
        owner: "hskksk",
        repo: "comitia",
        repositories: ["comitia"],
        permissions: { ...AGENT_GITHUB_TOKEN_PERMISSIONS },
      },
    ]);
  });

  it("returns 404 when the project has no installation", async () => {
    const github = createFakeGitHubClient({
      installationRepos: {
        "inst-1": [{ owner: "hskksk", repo: "comitia" }],
      },
    });
    const app = createBoardApp({ db, github });
    const { agentBody } = await bootstrapOwnerAndAgent(app, {
      repoUrl: "https://github.com/hskksk/comitia",
    });
    const res = await app.request("/v1/me/github-credentials", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "github credentials unavailable",
    });
    expect(github.mintCalls).toEqual([]);
  });

  it("returns 400 when the agent has multiple memberships and no projectId", async () => {
    const github = createFakeGitHubClient({
      installationRepos: {
        "inst-1": [{ owner: "hskksk", repo: "comitia" }],
      },
    });
    const app = createBoardApp({ db, github });
    const { initBody, agentBody } = await bootstrapOwnerAndAgent(app, {
      repoUrl: "https://github.com/hskksk/comitia",
    });
    const second = await createProject(db, {
      name: "other",
      ownerParticipantId: initBody.ownerId,
    });
    await addMembership(db, {
      projectId: second.id,
      participantId: agentBody.agentId,
      actorId: initBody.ownerId,
    });

    const res = await app.request("/v1/me/github-credentials", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "project required" });
  });

  it("mints for an explicit projectId when the agent is a member", async () => {
    const github = createFakeGitHubClient({
      installationRepos: {
        "inst-2": [{ owner: "hskksk", repo: "other" }],
      },
    });
    const app = createBoardApp({ db, github });
    const { initBody, agentBody } = await bootstrapOwnerAndAgent(app);
    const second = await createProject(db, {
      name: "other",
      ownerParticipantId: initBody.ownerId,
      repoUrl: "https://github.com/hskksk/other",
    });
    await db
      .update(projects)
      .set({
        githubInstallationId: "inst-2",
        githubOwner: "hskksk",
        githubRepo: "other",
      })
      .where(eq(projects.id, second.id));
    await addMembership(db, {
      projectId: second.id,
      participantId: agentBody.agentId,
      actorId: initBody.ownerId,
    });

    const res = await app.request("/v1/me/github-credentials", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({ projectId: second.id }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      token: "ghs_fake_inst-2_hskksk_other",
      owner: "hskksk",
      repo: "other",
    });
  });

  it("returns 403 for a human token", async () => {
    const app = createBoardApp({
      db,
      github: createFakeGitHubClient(),
    });
    const { initBody } = await bootstrapOwnerAndAgent(app);
    const res = await app.request("/v1/me/github-credentials", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${initBody.ownerToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("returns 503 when GitHub is not configured", async () => {
    const app = createBoardApp({ db });
    const { agentBody } = await bootstrapOwnerAndAgent(app, {
      repoUrl: "https://github.com/hskksk/comitia",
    });
    const res = await app.request("/v1/me/github-credentials", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "GitHub App is not configured",
    });
  });

  it("returns 502 when GitHub mint fails", async () => {
    const github = createFakeGitHubClient({
      installationRepos: {
        "inst-1": [{ owner: "hskksk", repo: "comitia" }],
      },
      tokenMintError: "boom",
    });
    const app = createBoardApp({ db, github });
    const { initBody, agentBody } = await bootstrapOwnerAndAgent(app, {
      repoUrl: "https://github.com/hskksk/comitia",
    });
    await db
      .update(projects)
      .set({
        githubInstallationId: "inst-1",
        githubOwner: "hskksk",
        githubRepo: "comitia",
      })
      .where(eq(projects.id, initBody.projectId));

    const res = await app.request("/v1/me/github-credentials", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "failed to mint GitHub credentials",
    });
  });
});
