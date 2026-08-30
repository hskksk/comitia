import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adoptDefaultFounding,
  bootstrapBoard,
  createFakeGitHubClient,
  registerAgent,
  schema,
  startBoardServer,
  type GitHubClient,
} from "@comitia/board";
import { connectCommand } from "./commands/connect.js";
import { saveConfig } from "./config.js";
import { createMcpProxyRuntime } from "./mcp-proxy.js";
import { createFakeEnginePlugin } from "./plugins/fake.js";
import {
  createInteractiveFakeEnginePlugin,
  createScriptedIo,
} from "./plugins/interactive-fake.js";
import type { EngineGithubAuth, EnginePlugin } from "./plugins/types.js";
import { ensureRepoCheckout, runSessionLoop } from "./session-loop.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function createDb() {
  const client = new PGlite();
  cleanups.push(() => client.close());
  const db = drizzle(client, { schema });
  const here = dirname(fileURLToPath(import.meta.url));
  await migrate(db, {
    migrationsFolder: join(here, "../../board/drizzle"),
  });
  return db as unknown as Parameters<typeof startBoardServer>[0]["db"];
}

async function bootAgent(
  db: Awaited<ReturnType<typeof createDb>>,
  options?: { repoUrl?: string; github?: GitHubClient },
) {
  const server = await startBoardServer({
    db,
    port: 0,
    github: options?.github,
  });
  cleanups.push(() => server.close());
  const boot = await bootstrapBoard(db, {
    ownerDisplayName: "ハル",
    projectName: "comitia",
    repoUrl: options?.repoUrl,
  });
  const registered = await registerAgent(db, {
    ownerParticipantId: boot.owner.id,
    displayName: "mika",
    engine: "claude-code",
  });
  await adoptDefaultFounding(db, {
    projectId: boot.project.id,
    ownerId: boot.owner.id,
  });
  const configDir = await mkdtemp(join(tmpdir(), "comitia-session-"));
  cleanups.push(() => rm(configDir, { recursive: true }));
  await saveConfig(configDir, {
    boardUrl: server.baseUrl,
    agents: {
      mika: {
        agentId: registered.agent.id,
        token: registered.agentToken,
        engine: "claude-code",
      },
    },
  });
  return {
    db,
    registered,
    configDir,
    boardUrl: server.baseUrl,
    projectId: boot.project.id,
  };
}

function wrapPlugin(inner: EnginePlugin): {
  plugin: EnginePlugin;
  stopped: () => boolean;
  workDir: () => string | undefined;
  workDirPersistent: () => boolean | undefined;
  github: () => EngineGithubAuth | null | undefined;
  prompts: () => string[];
  environmentPrompt: () => string | undefined;
} {
  let stopped = false;
  let workDir: string | undefined;
  let workDirPersistent: boolean | undefined;
  let github: EngineGithubAuth | null | undefined;
  let environmentPrompt: string | undefined;
  const prompts: string[] = [];
  return {
    plugin: {
      start: async (session) => {
        workDir = session.workDir;
        workDirPersistent = session.workDirPersistent;
        github = session.github;
        environmentPrompt = session.environmentPrompt;
        await inner.start(session);
      },
      run: (prompt) => {
        prompts.push(prompt);
        return inner.run(prompt);
      },
      report: () => inner.report(),
      stop: async () => {
        await inner.stop();
        stopped = true;
      },
      dispose: () => inner.dispose(),
      updateGithubAuth: async (auth) => {
        github = auth;
        await inner.updateGithubAuth?.(auth);
      },
    },
    stopped: () => stopped,
    workDir: () => workDir,
    workDirPersistent: () => workDirPersistent,
    github: () => github,
    prompts: () => prompts,
    environmentPrompt: () => environmentPrompt,
  };
}

async function createFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "comitia-fixture-repo-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "test"]);
  await writeFile(join(dir, "README.md"), "hello from the fixture repo\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "initial"]);
  return dir;
}

describe("ensureRepoCheckout", () => {
  it("clones into an empty work dir", async () => {
    const repo = await createFixtureRepo();
    const workDir = await mkdtemp(join(tmpdir(), "comitia-checkout-"));
    cleanups.push(() => rm(workDir, { recursive: true, force: true }));

    const result = ensureRepoCheckout(workDir, repo);
    expect(result.ok).toBe(true);
    expect(readFileSync(join(workDir, "README.md"), "utf8")).toContain(
      "hello from the fixture repo",
    );
  });

  it("pulls instead of cloning when the work dir already has a .git", async () => {
    const repo = await createFixtureRepo();
    const workDir = await mkdtemp(join(tmpdir(), "comitia-checkout-"));
    cleanups.push(() => rm(workDir, { recursive: true, force: true }));

    expect(ensureRepoCheckout(workDir, repo).ok).toBe(true);

    execFileSync(
      "git",
      ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "--allow-empty", "-q", "-m", "second"],
      { cwd: repo, encoding: "utf8" },
    );

    const second = ensureRepoCheckout(workDir, repo);
    expect(second.ok).toBe(true);
    const log = execFileSync("git", ["-C", workDir, "log", "--oneline"], {
      encoding: "utf8",
    });
    expect(log.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("reports failure without throwing when the repo can't be reached", () => {
    const workDir = join(tmpdir(), `comitia-checkout-missing-${Date.now()}`);
    cleanups.push(() => rm(workDir, { recursive: true, force: true }));
    const result = ensureRepoCheckout(workDir, "/no/such/path/on/disk");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe("session loop with fake engine", () => {
  it("completes goals then ends the session through connect", async () => {
    const { db, registered, configDir, boardUrl } = await bootAgent(
      await createDb(),
    );
    const runtime = createMcpProxyRuntime({
      boardUrl,
      agentToken: registered.agentToken,
    });
    const wrapped = wrapPlugin(
      createFakeEnginePlugin({
        callTool: (name, args) => runtime.callTool(name, args),
        script: [
          { tool: "get_briefing", args: {} },
          {
            tool: "set_goals",
            args: {
              goals: ["docs/sample.md の typo を直す", "report を投稿する"],
            },
          },
          { tool: "complete_goal", args: {} },
          { tool: "complete_goal", args: {} },
        ],
        handover: "目標を完了した",
      }),
    );

    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
    });
    cleanups.push(() => handle.close());

    await vi.waitFor(
      async () => {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.participantId, registered.agent.id));
        expect(session?.briefingAt).not.toBeNull();
        expect(session?.endedReason).toBe("completed");
        const [handover] = await db
          .select()
          .from(schema.handovers)
          .where(eq(schema.handovers.sessionId, session!.id));
        expect(handover?.body).toBe("目標を完了した");
        expect(wrapped.stopped()).toBe(true);
        expect(wrapped.environmentPrompt()).toContain("ロールは未設定");
        expect(wrapped.environmentPrompt()).toContain("立ち位置を 1 つ選ぶ");
        const dir = wrapped.workDir();
        expect(dir).toBeTruthy();
        expect(existsSync(dir!)).toBe(false);
      },
      { timeout: 15_000 },
    );
  }, 20_000);

  it("keeps a caller-provided COMITIA_WORK_DIR after the session ends", async () => {
    const { db, registered, configDir, boardUrl } = await bootAgent(
      await createDb(),
    );
    const runtime = createMcpProxyRuntime({
      boardUrl,
      agentToken: registered.agentToken,
    });
    const persistentDir = await mkdtemp(
      join(tmpdir(), "comitia-persistent-work-"),
    );
    const previous = process.env.COMITIA_WORK_DIR;
    process.env.COMITIA_WORK_DIR = persistentDir;
    cleanups.push(async () => {
      if (previous === undefined) {
        delete process.env.COMITIA_WORK_DIR;
      } else {
        process.env.COMITIA_WORK_DIR = previous;
      }
      await rm(persistentDir, { recursive: true, force: true });
    });

    const wrapped = wrapPlugin(
      createFakeEnginePlugin({
        callTool: (name, args) => runtime.callTool(name, args),
        script: [
          { tool: "get_briefing", args: {} },
          {
            tool: "set_goals",
            args: { goals: ["report を投稿する"] },
          },
          { tool: "complete_goal", args: {} },
        ],
        handover: "永続ディレクトリで完了",
      }),
    );

    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
    });
    cleanups.push(() => handle.close());

    await vi.waitFor(
      async () => {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.participantId, registered.agent.id));
        expect(session?.endedReason).toBe("completed");
        expect(wrapped.stopped()).toBe(true);
        expect(wrapped.workDir()).toBe(persistentDir);
        expect(wrapped.workDirPersistent()).toBe(true);
        expect(existsSync(persistentDir)).toBe(true);
      },
      { timeout: 15_000 },
    );
  }, 20_000);

  it("clones the project's repoUrl into the work dir before the first run", async () => {
    const fixtureRepo = await createFixtureRepo();
    const { db, registered, configDir, boardUrl } = await bootAgent(
      await createDb(),
      { repoUrl: fixtureRepo },
    );
    const runtime = createMcpProxyRuntime({
      boardUrl,
      agentToken: registered.agentToken,
    });
    const persistentDir = await mkdtemp(
      join(tmpdir(), "comitia-repo-checkout-"),
    );
    const previous = process.env.COMITIA_WORK_DIR;
    process.env.COMITIA_WORK_DIR = persistentDir;
    cleanups.push(async () => {
      if (previous === undefined) {
        delete process.env.COMITIA_WORK_DIR;
      } else {
        process.env.COMITIA_WORK_DIR = previous;
      }
      await rm(persistentDir, { recursive: true, force: true });
    });

    const wrapped = wrapPlugin(
      createFakeEnginePlugin({
        callTool: (name, args) => runtime.callTool(name, args),
        script: [
          { tool: "get_briefing", args: {} },
          { tool: "set_goals", args: { goals: ["README を読む"] } },
          { tool: "complete_goal", args: {} },
        ],
        handover: "リポジトリを読んで完了",
      }),
    );

    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
    });
    cleanups.push(() => handle.close());

    await vi.waitFor(
      async () => {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.participantId, registered.agent.id));
        expect(session?.endedReason).toBe("completed");
        expect(existsSync(join(persistentDir, "README.md"))).toBe(true);
        expect(readFileSync(join(persistentDir, "README.md"), "utf8")).toContain(
          "hello from the fixture repo",
        );
      },
      { timeout: 15_000 },
    );
  }, 20_000);

  it("passes minted GitHub credentials into plugin.start", async () => {
    const github = createFakeGitHubClient({
      installationRepos: {
        "inst-1": [{ owner: "hskksk", repo: "comitia" }],
      },
    });
    const { db, registered, configDir, boardUrl, projectId } = await bootAgent(
      await createDb(),
      {
        repoUrl: "https://github.com/hskksk/comitia",
        github,
      },
    );
    await db
      .update(schema.projects)
      .set({
        githubInstallationId: "inst-1",
        githubOwner: "hskksk",
        githubRepo: "comitia",
      })
      .where(eq(schema.projects.id, projectId));

    const runtime = createMcpProxyRuntime({
      boardUrl,
      agentToken: registered.agentToken,
    });
    const wrapped = wrapPlugin(
      createFakeEnginePlugin({
        callTool: (name, args) => runtime.callTool(name, args),
        script: [
          { tool: "get_briefing", args: {} },
          { tool: "set_goals", args: { goals: ["README を読む"] } },
          { tool: "complete_goal", args: {} },
        ],
        handover: "完了",
      }),
    );
    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
    });
    cleanups.push(() => handle.close());

    await vi.waitFor(
      async () => {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.participantId, registered.agent.id));
        expect(session?.endedReason).toBe("completed");
        expect(wrapped.github()).toEqual({
          token: "ghs_fake_inst-1_hskksk_comitia",
          expiresAt: expect.any(String),
          committerName: "mika@ハル",
        });
      },
      { timeout: 15_000 },
    );
  }, 20_000);

  it("starts with github null when credentials are unavailable", async () => {
    const { db, registered, configDir, boardUrl } = await bootAgent(
      await createDb(),
      { repoUrl: "https://github.com/hskksk/comitia" },
    );
    const runtime = createMcpProxyRuntime({
      boardUrl,
      agentToken: registered.agentToken,
    });
    const wrapped = wrapPlugin(
      createFakeEnginePlugin({
        callTool: (name, args) => runtime.callTool(name, args),
        script: [
          { tool: "get_briefing", args: {} },
          { tool: "set_goals", args: { goals: ["README を読む"] } },
          { tool: "complete_goal", args: {} },
        ],
        handover: "完了",
      }),
    );
    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
    });
    cleanups.push(() => handle.close());

    await vi.waitFor(
      async () => {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.participantId, registered.agent.id));
        expect(session?.endedReason).toBe("completed");
        expect(wrapped.github()).toBeNull();
      },
      { timeout: 15_000 },
    );
  }, 20_000);

  it("winds down after repeated identical read_thread calls", async () => {
    const { db, registered, configDir, boardUrl } = await bootAgent(
      await createDb(),
    );
    const runtime = createMcpProxyRuntime({
      boardUrl,
      agentToken: registered.agentToken,
    });
    const wrapped = wrapPlugin(
      createFakeEnginePlugin({
        callTool: (name, args) => runtime.callTool(name, args),
        script: [
          { tool: "get_briefing", args: {} },
          {
            tool: "set_goals",
            args: { goals: ["docs/sample.md の typo を直す"] },
          },
          {
            tool: "create_thread",
            args: {
              type: "consultation",
              title: "idle check",
              trigger: "empty loop",
              duplicateSearchQuery: "idle",
              conflictCitationsChecked: true,
            },
          },
          { tool: "read_thread", args: {} },
          { tool: "read_thread", args: {} },
        ],
        handover: "空転検知で終了",
      }),
    );

    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
    });
    cleanups.push(() => handle.close());

    await vi.waitFor(
      async () => {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.participantId, registered.agent.id));
        expect(session?.endedReason).toBe("completed");
        const [handover] = await db
          .select()
          .from(schema.handovers)
          .where(eq(schema.handovers.sessionId, session!.id));
        expect(handover?.body).toBe("空転検知で終了");
        expect(wrapped.stopped()).toBe(true);
      },
      { timeout: 15_000 },
    );
  }, 20_000);

  it("still runs wind-down and end_session when maxRuns is reached", async () => {
    const { db, registered, boardUrl } = await bootAgent(await createDb());
    const requested = await fetch(`${boardUrl}/v1/me/request-session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${registered.agentToken}`,
      },
      body: "{}",
    });
    expect(requested.ok).toBe(true);
    const body = (await requested.json()) as { sessionId: string };
    const sessionId = body.sessionId;
    expect(sessionId).toBeTruthy();

    const runtime = createMcpProxyRuntime({
      boardUrl,
      agentToken: registered.agentToken,
    });
    const toolsCalled: string[] = [];
    const wrapped = wrapPlugin(
      createFakeEnginePlugin({
        callTool: async (name, args) => {
          toolsCalled.push(name);
          return runtime.callTool(name, args);
        },
        script: [
          { tool: "get_briefing", args: {} },
          {
            tool: "set_goals",
            args: { goals: ["docs/sample.md の typo を直す"] },
          },
        ],
        handover: "maxRuns で終了",
      }),
    );

    await runSessionLoop({
      plugin: wrapped.plugin,
      callTool: (name, args) => runtime.callTool(name, args),
      onChatLog: async () => undefined,
      maxRuns: 1,
      idleRunLimit: 2,
      windDownRequestedRef: { current: false },
      sessionId,
      boardUrl,
      agentToken: registered.agentToken,
    });

    const prompts = wrapped.prompts();
    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts.at(-1)).toContain("セッション終了作業");
    expect(toolsCalled.filter((name) => name === "end_session")).toEqual([
      "end_session",
    ]);

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
    expect(session?.endedReason).toBe("completed");
    const [handover] = await db
      .select()
      .from(schema.handovers)
      .where(eq(schema.handovers.sessionId, sessionId));
    expect(handover?.body).toBe("maxRuns で終了");
    expect(wrapped.stopped()).toBe(true);
  }, 20_000);
});

describe("interactive fake engine through connect", () => {
  it("lets a human finish a session with prompted tools", async () => {
    const { db, registered, configDir, boardUrl } = await bootAgent(
      await createDb(),
    );
    const runtime = createMcpProxyRuntime({
      boardUrl,
      agentToken: registered.agentToken,
    });
    const scripted = createScriptedIo([
      "1",
      'json set_goals {"goals":["typo を直す"]}',
      "complete_goal",
      "",
      "",
      "done",
      'json end_session {"handover":"一日を体験した"}',
    ]);
    const wrapped = wrapPlugin(
      createInteractiveFakeEnginePlugin({
        io: scripted.io,
        callTool: (name, args) => runtime.callTool(name, args),
      }),
    );

    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
    });
    cleanups.push(() => handle.close());

    await vi.waitFor(
      async () => {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.participantId, registered.agent.id));
        expect(session?.endedReason).toBe("completed");
        const [handover] = await db
          .select()
          .from(schema.handovers)
          .where(eq(schema.handovers.sessionId, session!.id));
        expect(handover?.body).toBe("一日を体験した");
        expect(wrapped.stopped()).toBe(true);
      },
      { timeout: 15_000 },
    );

    expect(scripted.output()).toContain("get_briefing");
    expect(scripted.output()).toContain("終了作業です");
  }, 20_000);
});
