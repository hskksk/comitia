import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapBoard,
  registerAgent,
  schema,
  startBoardServer,
} from "@comitia/board";
import { connectCommand } from "./commands/connect.js";
import { saveConfig } from "./config.js";
import { createMcpProxyRuntime } from "./mcp-proxy.js";
import { createFakeEnginePlugin } from "./plugins/fake.js";
import {
  createInteractiveFakeEnginePlugin,
  createScriptedIo,
} from "./plugins/interactive-fake.js";
import type { EnginePlugin } from "./plugins/types.js";
import { runSessionLoop } from "./session-loop.js";

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

async function bootAgent(db: Awaited<ReturnType<typeof createDb>>) {
  const server = await startBoardServer({ db, port: 0 });
  cleanups.push(() => server.close());
  const boot = await bootstrapBoard(db, {
    ownerDisplayName: "ハル",
    projectName: "comitia",
  });
  const registered = await registerAgent(db, {
    ownerParticipantId: boot.owner.id,
    displayName: "mika",
    engine: "claude-code",
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
  };
}

function wrapPlugin(inner: EnginePlugin): {
  plugin: EnginePlugin;
  stopped: () => boolean;
  workDir: () => string | undefined;
  workDirPersistent: () => boolean | undefined;
  prompts: () => string[];
} {
  let stopped = false;
  let workDir: string | undefined;
  let workDirPersistent: boolean | undefined;
  const prompts: string[] = [];
  return {
    plugin: {
      start: async (session) => {
        workDir = session.workDir;
        workDirPersistent = session.workDirPersistent;
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
    },
    stopped: () => stopped,
    workDir: () => workDir,
    workDirPersistent: () => workDirPersistent,
    prompts: () => prompts,
  };
}

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
      "end",
      "",
      "一日を体験した",
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
