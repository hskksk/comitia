import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { schema, startBoardServer } from "@comitia/board";
import { parseCliArgs, runCli } from "./cli.js";
import { USAGE_TEXT } from "./cli-usage.js";
import { loadConfig } from "./config.js";
import { doctorCommand } from "./commands/doctor.js";
import { statusCommand } from "./commands/status.js";
import { tokenCommand } from "./commands/token.js";
import { wakeCommand } from "./commands/wake.js";
import { initCommand } from "./commands/init.js";
import { registerCommand } from "./commands/register.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe("init and agent register commands", () => {
  it("parses init and agent register arguments", () => {
    expect(
      parseCliArgs([
        "init",
        "--board-url",
        "http://localhost:3000",
        "--name",
        "ハル",
        "--project",
        "comitia",
        "--repo-url",
        "https://github.com/hskksk/comitia",
      ]),
    ).toEqual({
      command: "init",
      boardUrl: "http://localhost:3000",
      name: "ハル",
      project: "comitia",
      repoUrl: "https://github.com/hskksk/comitia",
    });
    expect(
      parseCliArgs([
        "agent",
        "register",
        "--engine",
        "claude-code",
        "--name",
        "mika",
      ]),
    ).toEqual({
      command: "agent-register",
      engine: "claude-code",
      name: "mika",
    });
  });

  it("parses agent connect arguments", () => {
    expect(parseCliArgs(["agent", "connect", "mika"])).toEqual({
      command: "agent-connect",
      name: "mika",
    });
  });

  it("parses help commands", () => {
    expect(parseCliArgs([])).toEqual({ command: "help" });
    expect(parseCliArgs(["help"])).toEqual({ command: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ command: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ command: "help" });
  });

  it("parses operator commands", () => {
    expect(parseCliArgs(["token"])).toEqual({ command: "token" });
    expect(parseCliArgs(["status"])).toEqual({ command: "status" });
    expect(parseCliArgs(["doctor"])).toEqual({ command: "doctor" });
    expect(parseCliArgs(["agent", "list"])).toEqual({ command: "agent-list" });
    expect(parseCliArgs(["agent", "wake", "mika"])).toEqual({
      command: "agent-wake",
      name: "mika",
    });
    expect(parseCliArgs(["agent", "update", "mika", "--engine", "claude-code"])).toEqual({
      command: "agent-update",
      name: "mika",
      engine: "claude-code",
    });
  });

  it("rejects missing agent connect name with usage", () => {
    expect(() => parseCliArgs(["agent", "connect"])).toThrow(
      "Usage: comitia agent connect <name>",
    );
  });

  it("rejects unknown subcommands with usage", () => {
    expect(() => parseCliArgs(["agent", "connect"])).toThrow("Usage:");
    expect(() => parseCliArgs(["stauts"])).toThrow("不明なコマンド");
    expect(() => parseCliArgs(["stauts"])).toThrow("status");
  });

  it("prints help from runCli", async () => {
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk: Buffer | string) => {
      chunks.push(String(chunk));
    });
    await runCli(["help"], { stdout });
    expect(chunks.join("")).toContain(USAGE_TEXT);
  });

  it("initializes a project and registers an agent", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));

    const client = new PGlite();
    cleanups.push(() => client.close());
    const db = drizzle(client, { schema });
    const here = dirname(fileURLToPath(import.meta.url));
    await migrate(db, {
      migrationsFolder: join(here, "../../board/drizzle"),
    });
    const server = await startBoardServer({
      db: db as unknown as Parameters<typeof startBoardServer>[0]["db"],
      port: 0,
    });
    cleanups.push(() => server.close());

    await initCommand({
      boardUrl: server.baseUrl,
      name: "ハル",
      project: "comitia",
      configDir,
    });
    const config = await loadConfig(configDir);
    expect(config.ownerToken).toMatch(/^comt_/);
    expect(config.ownerId).toBeTruthy();
    expect(config.projectId).toBeTruthy();

    await registerCommand({
      name: "mika",
      engine: "claude-code",
      configDir,
    });
    const registered = await loadConfig(configDir);
    expect(registered.agents.mika?.agentId).toBeTruthy();
    expect(registered.agents.mika?.token).toMatch(/^comt_/);
    expect(registered.agents.mika?.engine).toBe("claude-code");
  });

  it("rejects unsupported engines before making a request", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));

    await expect(
      registerCommand({
        name: "mika",
        engine: "other",
        configDir,
      }),
    ).rejects.toThrow("Unsupported engine");
  });
});

describe("operator commands", () => {
  async function writeConfig(configDir: string): Promise<void> {
    await writeFile(
      join(configDir, "config.json"),
      `${JSON.stringify(
        {
          boardUrl: "http://127.0.0.1:8787",
          ownerToken: "comt_owner_test",
          ownerId: "owner-1",
          projectId: "project-1",
          agents: {
            mika: {
              agentId: "agent-1",
              token: "comt_agent_test",
              engine: "claude-code",
            },
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }

  it("prints owner token and warns on tty", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const stdout = new PassThrough() as PassThrough & { isTTY: boolean };
    stdout.isTTY = true;
    const stderr = new PassThrough();
    const out: string[] = [];
    const err: string[] = [];
    stdout.on("data", (chunk) => out.push(String(chunk)));
    stderr.on("data", (chunk) => err.push(String(chunk)));

    await tokenCommand({ configDir, stdout, stderr });
    expect(out.join("")).toBe("comt_owner_test\n");
    expect(err.join("")).toContain("秘密");
  });

  it("prints agent list without tokens", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await runCli(["agent", "list"], { configDir, stdout });
    const output = chunks.join("");
    expect(output).toContain("mika\tclaude-code\tagent-1");
    expect(output).not.toContain("comt_");
  });

  it("prints status from mocked board responses", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/v1/me")) {
        return new Response(
          JSON.stringify({
            participant: { displayName: "ハル" },
            projectId: "project-1",
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/v1/queue")) {
        return new Response(JSON.stringify({ items: [{}, {}] }), {
          status: 200,
        });
      }
      if (url.includes("/connection")) {
        return new Response(JSON.stringify({ status: "disconnected" }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await statusCommand({ configDir, fetch: fetchMock as typeof fetch, stdout });
    const output = chunks.join("");
    expect(output).toContain("稼働中");
    expect(output).toContain("判断キュー: 2 件");
    expect(output).toContain("mika (claude-code): disconnected");
    expect(output).not.toContain("comt_");
  });

  it("reports doctor findings for a temp config dir", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("error", { status: 500 });
    });

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await doctorCommand({ configDir, fetch: fetchMock as typeof fetch, stdout });
    const output = chunks.join("");
    expect(output).toContain("設定ファイル");
    expect(output).toContain("0600");
    expect(output).toContain("boardUrl");
    expect(output).toContain("ボード: 稼働中");
  });

  it("tells how to start the board from the repo root when it is down", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await doctorCommand({ configDir, fetch: fetchMock as typeof fetch, stdout });
    const output = chunks.join("");
    expect(output).toContain("ボード: 到達できません");
    expect(output).toContain("pnpm build && pnpm start");
    expect(output).toContain("pnpm dogfood");
  });

  it("wakes an agent via owner request-session", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sessionId: "sess-1",
          tickId: "tick-1",
          status: "queued",
        }),
        { status: 200 },
      ),
    );

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await wakeCommand({
      name: "mika",
      configDir,
      fetch: fetchMock as typeof fetch,
      stdout,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const calls = fetchMock.mock.calls as unknown as Array<
      [string | URL, RequestInit | undefined]
    >;
    expect(String(calls[0]![0])).toBe(
      "http://127.0.0.1:8787/v1/agents/agent-1/request-session",
    );
    expect(calls[0]![1]).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer comt_owner_test",
        "content-type": "application/json",
      },
    });
    expect(chunks.join("")).toContain("キューに積みました");
  });
});
