import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptDefaultFounding,
  bootstrapBoard,
  registerAgent,
  schema,
  startBoardServer,
} from "@comitia/board";
import { connectCommand } from "./commands/connect.js";
import { saveConfig } from "./config.js";
import { instructConnectBanner } from "./instruct-loop.js";
import type { EnginePlugin } from "./plugins/types.js";
import { INITIAL_PROMPT } from "./prompts.js";

const cleanups: Array<() => Promise<void> | void> = [];

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "comitia-xdg-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  cleanups.push(async () => {
    if (previous === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = previous;
    }
    await rm(dir, { recursive: true, force: true });
  });
});

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

async function bootAgent() {
  const db = await createDb();
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
  await adoptDefaultFounding(db, {
    projectId: boot.project.id,
    ownerId: boot.owner.id,
  });
  const configDir = await mkdtemp(join(tmpdir(), "comitia-instruct-"));
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
  return { db, registered, configDir, boardUrl: server.baseUrl, server };
}

function recordingPlugin() {
  let sessionId: string | undefined;
  let environmentPrompt: string | undefined;
  let stopped = false;
  const prompts: string[] = [];
  const plugin: EnginePlugin = {
    async start(session) {
      sessionId = session.sessionId;
      environmentPrompt = session.environmentPrompt;
    },
    async run(prompt) {
      prompts.push(prompt);
      return { transcript: prompt, toolLog: [], remainingBudget: null };
    },
    async report() {
      return { tokens: 0 };
    },
    async stop() {
      stopped = true;
    },
    async dispose() {},
  };
  return {
    plugin,
    prompts: () => prompts,
    sessionId: () => sessionId,
    environmentPrompt: () => environmentPrompt,
    stopped: () => stopped,
  };
}

describe("instructConnectBanner", () => {
  it("prints the instruct-mode greeting", () => {
    expect(instructConnectBanner("walker", false)).toBe(
      "walker を指示モードで接続しています。行を入力して Enter。空行は無視。Ctrl-D で終了。Ctrl-C で切断します。\n",
    );
    expect(instructConnectBanner("walker", true)).toContain(
      "既定のシステムプロンプト（環境とツール解説）を渡します。",
    );
  });
});

describe("connect --instruct", () => {
  it("runs stdin lines without request-session or INITIAL_PROMPT", async () => {
    const { db, registered, configDir } = await bootAgent();
    const originalFetch = globalThis.fetch;
    let requestSessionCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/v1/me/request-session")) {
          requestSessionCalls += 1;
        }
        return originalFetch(input, init);
      }),
    );
    cleanups.push(() => {
      vi.unstubAllGlobals();
    });

    const wrapped = recordingPlugin();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.resume();

    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
      instruct: true,
      stdin,
      stdout,
    });
    cleanups.push(() => handle.close());

    expect(wrapped.sessionId()).toBe("instruct");
    expect(wrapped.environmentPrompt()).toBe("");

    stdin.write("hello\n");
    stdin.write("\n");
    stdin.write("  world  \n");
    stdin.end();

    await vi.waitFor(() => {
      expect(wrapped.prompts()).toEqual(["hello", "world"]);
      expect(wrapped.stopped()).toBe(true);
    });
    expect(wrapped.prompts().some((prompt) => prompt === INITIAL_PROMPT)).toBe(
      false,
    );
    expect(requestSessionCalls).toBe(0);
    const sessions = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.participantId, registered.agent.id));
    expect(sessions).toHaveLength(0);
  });

  it("passes the environment prompt only with --system-prompt", async () => {
    const { configDir } = await bootAgent();
    const wrapped = recordingPlugin();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.resume();

    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
      instruct: true,
      systemPrompt: true,
      stdin,
      stdout,
    });
    cleanups.push(() => handle.close());

    expect(wrapped.environmentPrompt()).toContain("ロールは未設定");
    expect(wrapped.environmentPrompt()).toContain(
      "性格に合うロールを選ぶのではない",
    );
    stdin.end();
    await vi.waitFor(() => expect(wrapped.stopped()).toBe(true));
  });

  it("acks session.start without starting the session loop", async () => {
    const { db, registered, configDir, server } = await bootAgent();
    const wrapped = recordingPlugin();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.resume();

    const handle = await connectCommand({
      name: "mika",
      configDir,
      plugin: wrapped.plugin,
      instruct: true,
      stdin,
      stdout,
    });
    cleanups.push(() => handle.close());

    const sent = await server.sendTick({
      participantId: registered.agent.id,
      type: "session.start",
    });
    await vi.waitFor(() =>
      expect(handle.ticks.map((tick) => tick.id)).toContain(sent.tickId),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(wrapped.prompts()).toEqual([]);
    expect(wrapped.sessionId()).toBe("instruct");
    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.participantId, registered.agent.id));
    expect(session?.briefingAt).toBeNull();
    stdin.end();
    await vi.waitFor(() => expect(wrapped.stopped()).toBe(true));
  });
});
