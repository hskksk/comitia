import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapBoard,
  createBoardApp,
  createFakeGitHubClient,
  schema,
} from "@comitia/board";
import { parseCliArgs } from "./cli.js";
import { loginCommand } from "./commands/login.js";
import { projectListCommand } from "./commands/project.js";
import { loadConfig, saveConfig } from "./config.js";
import {
  startOAuthCallbackServer,
  type OAuthCallbackServer,
} from "./oauth-callback.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function boardFetch(board: ReturnType<typeof createBoardApp>): typeof fetch {
  return (input, init) =>
    Promise.resolve(
      board.request(
        `${new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        ).pathname}${new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        ).search}`,
        init,
      ),
    );
}

async function setupBoard() {
  const client = new PGlite();
  cleanups.push(() => client.close());
  const db = drizzle(client, { schema });
  const here = dirname(fileURLToPath(import.meta.url));
  await migrate(db, {
    migrationsFolder: join(here, "../../board/drizzle"),
  });
  const github = createFakeGitHubClient({
    oauthCodes: { "good-code": { accessToken: "user-token-1" } },
    users: {
      "user-token-1": { id: "1001", login: "hskksk" },
    },
  });
  const boardUrl = "http://127.0.0.1:8787";
  const board = createBoardApp({
    db: db as never,
    github,
    githubPublicBaseUrl: boardUrl,
    githubOAuth: {
      enabled: true,
      appSlug: "comitia-board",
      clientId: "client-id",
    },
  });
  return { board, boardUrl, db };
}

async function completeGithubOAuth(
  fetchImpl: typeof fetch,
  boardUrl: string,
  callbackOrigin: string,
): Promise<void> {
  const start = await fetchImpl(
    `${boardUrl}/v1/auth/github?return_origin=${encodeURIComponent(callbackOrigin)}`,
    { redirect: "manual" },
  );
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location") ?? "");
  const state = authorize.searchParams.get("state");
  expect(state).toBeTruthy();

  const callback = await fetchImpl(
    `${boardUrl}/v1/auth/github/callback?code=good-code&state=${state}`,
    { redirect: "manual" },
  );
  expect(callback.status).toBe(302);
  const location = callback.headers.get("location") ?? "";
  expect(location).toContain(`${callbackOrigin}/login/callback?token=`);
  const browserHit = await fetch(location);
  expect(browserHit.status).toBe(200);
}

describe("login command", () => {
  it("parses login arguments", () => {
    expect(parseCliArgs(["login"])).toEqual({
      command: "login",
      boardUrl: undefined,
      noOpen: false,
    });
    expect(
      parseCliArgs(["login", "--board-url", "http://127.0.0.1:8787", "--no-open"]),
    ).toEqual({
      command: "login",
      boardUrl: "http://127.0.0.1:8787",
      noOpen: true,
    });
  });

  it("logs in via GitHub OAuth and updates config", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-login-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    const { board, boardUrl, db } = await setupBoard();
    const fetchImpl = boardFetch(board);

    const bootstrapped = await bootstrapBoard(db as never, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    await saveConfig(configDir, {
      boardUrl,
      ownerId: bootstrapped.owner.id,
      projectId: bootstrapped.project.id,
      ownerToken: bootstrapped.ownerToken,
      agents: {},
    });
    const staleToken = bootstrapped.ownerToken;

    let callbackServer: OAuthCallbackServer | undefined;
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk: Buffer | string) => {
      chunks.push(String(chunk));
    });

    const loginPromise = loginCommand({
      configDir,
      boardUrl,
      fetch: fetchImpl,
      stdout,
      noOpen: true,
      startCallbackServer: async () => {
        callbackServer = await startOAuthCallbackServer({ timeoutMs: 10_000 });
        return callbackServer;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callbackServer).toBeDefined();
    await completeGithubOAuth(fetchImpl, boardUrl, callbackServer!.callbackOrigin);
    await loginPromise;

    const after = await loadConfig(configDir);
    expect(after.ownerToken).toMatch(/^comt_/);
    expect(after.ownerToken).not.toBe(staleToken);
    expect(after.ownerId).toBe(bootstrapped.owner.id);
    expect(chunks.join("")).toContain("ログインしました");

    const staleMeRes = await fetchImpl(`${boardUrl}/v1/me`, {
      headers: { authorization: `Bearer ${staleToken}` },
    });
    expect(staleMeRes.status).toBe(200);

    const listOut: string[] = [];
    const listStdout = new PassThrough();
    listStdout.on("data", (chunk: Buffer | string) => {
      listOut.push(String(chunk));
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      await projectListCommand({ configDir, stdout: listStdout });
    } finally {
      globalThis.fetch = previousFetch;
    }
    expect(listOut.join("")).toContain("comitia");
  });

  it("rejects login when GitHub OAuth is disabled", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-login-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    const { board, boardUrl, db } = await setupBoard();
    const disabledBoard = createBoardApp({
      db: db as never,
      githubOAuth: { enabled: false },
    });

    await expect(
      loginCommand({
        configDir,
        boardUrl,
        fetch: boardFetch(disabledBoard),
        noOpen: true,
      }),
    ).rejects.toThrow(/GitHub OAuth/);
  });
});
