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
import type { EnginePlugin } from "./plugins/types.js";

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
} {
  let stopped = false;
  let workDir: string | undefined;
  return {
    plugin: {
      start: async (session) => {
        workDir = session.workDir;
        await inner.start(session);
      },
      run: (prompt) => inner.run(prompt),
      report: () => inner.report(),
      stop: async () => {
        await inner.stop();
        stopped = true;
      },
    },
    stopped: () => stopped,
    workDir: () => workDir,
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
});
