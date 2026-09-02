import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { schema, startBoardServer } from "@comitia/board";
import { parseCliArgs, runCli } from "./cli.js";
import { USAGE_TEXT } from "./cli-usage.js";
import { loadConfig } from "./config.js";
import { doctorCommand, opencodeDoctorFindings, claudeCliDoctorFinding } from "./commands/doctor.js";
import { statusCommand } from "./commands/status.js";
import { tokenCommand } from "./commands/token.js";
import { wakeCommand } from "./commands/wake.js";
import { agentLogsCommand } from "./commands/agent-logs.js";
import { initCommand } from "./commands/init.js";
import { registerCommand } from "./commands/register.js";
import {
  projectCommand,
  projectCreateCommand,
  projectListCommand,
  projectSetCommand,
  projectUseCommand,
} from "./commands/project.js";

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
        "--project",
        "proj-1",
      ]),
    ).toEqual({
      command: "agent-register",
      engine: "claude-code",
      name: "mika",
      project: "proj-1",
    });
    expect(
      parseCliArgs(["project", "create", "--name", "実験場"]),
    ).toEqual({
      command: "project-create",
      name: "実験場",
      repoUrl: undefined,
    });
    expect(parseCliArgs(["project", "list"])).toEqual({ command: "project-list" });
    expect(parseCliArgs(["project", "use", "proj-1"])).toEqual({
      command: "project-use",
      projectId: "proj-1",
    });
    expect(
      parseCliArgs([
        "agent",
        "register",
        "--engine",
        "claude-code",
        "--name",
        "walker",
        "--role",
        "proposer",
      ]),
    ).toEqual({
      command: "agent-register",
      engine: "claude-code",
      name: "walker",
      role: "proposer",
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
    expect(parseCliArgs(["agent", "logs", "mika"])).toEqual({
      command: "agent-logs",
      name: "mika",
      sessionId: undefined,
      follow: false,
      raw: false,
    });
    expect(
      parseCliArgs(["agent", "logs", "mika", "--session", "sess-1", "--follow"]),
    ).toEqual({
      command: "agent-logs",
      name: "mika",
      sessionId: "sess-1",
      follow: true,
      raw: false,
    });
    expect(parseCliArgs(["agent", "logs", "mika", "--raw"])).toEqual({
      command: "agent-logs",
      name: "mika",
      sessionId: undefined,
      follow: false,
      raw: true,
    });
    expect(parseCliArgs(["agent", "update", "mika", "--engine", "fake"])).toEqual({
      command: "agent-update",
      name: "mika",
      engine: "fake",
      personality: undefined,
    });
    expect(
      parseCliArgs([
        "agent",
        "update",
        "mika",
        "--personality",
        "慎重",
      ]),
    ).toEqual({
      command: "agent-update",
      name: "mika",
      engine: undefined,
      personality: "慎重",
    });
    expect(
      parseCliArgs([
        "agent",
        "register",
        "--engine",
        "fake",
        "--name",
        "walker",
        "--personality",
        "対立保持",
      ]),
    ).toEqual({
      command: "agent-register",
      engine: "fake",
      name: "walker",
      role: undefined,
      project: undefined,
      personality: "対立保持",
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

    await registerCommand({
      name: "walker",
      engine: "fake",
      configDir,
    });
    const withFake = await loadConfig(configDir);
    expect(withFake.agents.walker?.engine).toBe("fake");
    expect(withFake.agents.walker?.agentId).toBeTruthy();
  });

  it("creates, lists, and switches projects", async () => {
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
    const originalId = (await loadConfig(configDir)).projectId!;
    await projectCreateCommand({ name: "実験場", configDir });
    const afterCreate = await loadConfig(configDir);
    expect(afterCreate.projectId).toBeTruthy();
    expect(afterCreate.projectId).not.toBe(originalId);

    const chunks: string[] = [];
    const stdout = new PassThrough();
    stdout.on("data", (chunk: Buffer | string) => {
      chunks.push(String(chunk));
    });
    await projectListCommand({ configDir, stdout });
    expect(chunks.join("")).toContain("実験場");
    expect(chunks.join("")).toContain("comitia");

    const currentChunks: string[] = [];
    const currentOut = new PassThrough();
    currentOut.on("data", (chunk: Buffer | string) => {
      currentChunks.push(String(chunk));
    });
    await projectCommand({ configDir, stdout: currentOut });
    expect(currentChunks.join("")).toContain("プロジェクト: 実験場");

    await projectUseCommand({ projectId: originalId, configDir });
    expect((await loadConfig(configDir)).projectId).toBe(originalId);

    const switchedChunks: string[] = [];
    const switchedOut = new PassThrough();
    switchedOut.on("data", (chunk: Buffer | string) => {
      switchedChunks.push(String(chunk));
    });
    await projectCommand({ configDir, stdout: switchedOut });
    expect(switchedChunks.join("")).toContain("プロジェクト: comitia");

    const setOut = new PassThrough();
    const setChunks: string[] = [];
    setOut.on("data", (chunk: Buffer | string) => {
      setChunks.push(String(chunk));
    });
    await projectSetCommand({
      configDir,
      repoUrl: "https://github.com/hskksk/comitia",
      clearRepo: false,
      stdout: setOut,
    });
    expect(setChunks.join("")).toContain("https://github.com/hskksk/comitia");
  });

  it("assigns a role only when --role is given", async () => {
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

    await registerCommand({ name: "mika", engine: "claude-code", configDir });
    const mika = (await loadConfig(configDir)).agents.mika;
    const mikaRoles = await db
      .select()
      .from(schema.roleAssignments)
      .where(eq(schema.roleAssignments.participantId, mika!.agentId));
    expect(mikaRoles).toEqual([]);

    await registerCommand({
      name: "walker",
      engine: "claude-code",
      role: "proposer",
      configDir,
    });
    const walker = (await loadConfig(configDir)).agents.walker;
    const walkerRoles = await db
      .select()
      .from(schema.roleAssignments)
      .where(eq(schema.roleAssignments.participantId, walker!.agentId));
    expect(walkerRoles).toHaveLength(1);
    expect(walkerRoles[0]?.role).toBe("proposer");
  });

  it("registers personality from a packaged resource name", async () => {
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
    await registerCommand({
      name: "walker",
      engine: "fake",
      personality: "慎重",
      configDir,
    });
    const walker = (await loadConfig(configDir)).agents.walker;
    const [row] = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, walker!.agentId));
    expect(row?.personality).toBe(
      "リスクと失敗モードを先に出す。根拠が薄い合意は急がない。壊れる人・壊れる手順を具体的に名指す。",
    );
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
      if (String(input).endsWith("/v1/me/github-credentials")) {
        return new Response(
          JSON.stringify({ error: "GitHub App is not configured" }),
          { status: 503 },
        );
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
    expect(output).toContain("GitHub 実行資格: ボードに GitHub App が設定されていない");
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

  it("skips Claude Code when every agent uses the fake engine", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeFile(
      join(configDir, "config.json"),
      `${JSON.stringify(
        {
          boardUrl: "http://127.0.0.1:8787",
          ownerToken: "comt_owner_test",
          ownerId: "owner-1",
          projectId: "project-1",
          agents: {
            walker: {
              agentId: "agent-fake",
              token: "comt_agent_test",
              engine: "fake",
            },
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(input).endsWith("/v1/me/github-credentials")) {
        return new Response(
          JSON.stringify({ error: "GitHub App is not configured" }),
          { status: 503 },
        );
      }
      return new Response("error", { status: 500 });
    });
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await doctorCommand({ configDir, fetch: fetchMock as typeof fetch, stdout });
    const output = chunks.join("");
    expect(output).toContain("エンジン: fake");
    expect(output).not.toContain("Claude Code CLI が見つかりません");
    expect(output).not.toContain("Claude 認証:");
  });

  it("maps enginebay doctor output into Japanese OpenCode findings", () => {
    expect(
      opencodeDoctorFindings({
        ok: false,
        engine: "opencode",
        cli: { found: false, command: "opencode" },
        auth: { found: false, detail: "missing" },
        message: "opencode CLI is not on PATH",
      }),
    ).toEqual([
      {
        ok: false,
        message:
          "OpenCode CLI が見つかりません（PATH に opencode がありません）。エージェント接続には必要です。",
      },
      {
        ok: true,
        message: "OpenCode 認証: ホストで `opencode auth` を実行してください",
      },
    ]);
  });

  it("maps enginebay doctor output into Japanese Claude CLI findings", () => {
    expect(
      claudeCliDoctorFinding({
        ok: false,
        engine: "claude-code",
        cli: { found: false, command: "claude" },
        auth: { found: false, detail: "missing" },
        message: "claude CLI is not on PATH",
      }),
    ).toEqual({
      ok: false,
      message:
        "Claude Code CLI が見つかりません（PATH に claude がありません）。エージェント接続には必要です。",
    });
    expect(
      claudeCliDoctorFinding({
        ok: true,
        engine: "claude-code",
        cli: { found: true, command: "claude", version: "1.0.0-fake" },
        auth: { found: true, detail: "credentials" },
        message: "ok",
      }),
    ).toEqual({
      ok: true,
      message: "claude が PATH にあります（1.0.0-fake）",
    });
  });

  it("checks OpenCode when an agent uses that engine", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    const hostHome = await mkdtemp(join(tmpdir(), "comitia-doctor-oc-home-"));
    const binDir = await mkdtemp(join(tmpdir(), "comitia-doctor-oc-bin-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    cleanups.push(() => rm(hostHome, { recursive: true }));
    cleanups.push(() => rm(binDir, { recursive: true }));
    await writeFile(
      join(configDir, "config.json"),
      `${JSON.stringify(
        {
          boardUrl: "http://127.0.0.1:8787",
          ownerToken: "comt_owner_test",
          ownerId: "owner-1",
          projectId: "project-1",
          agents: {
            sou: {
              agentId: "agent-oc",
              token: "comt_agent_test",
              engine: "opencode",
            },
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    const fake = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../enginebay/test/fake-opencode.mjs",
    );
    await chmod(fake, 0o755);
    await symlink(fake, join(binDir, "opencode"));
    await mkdir(join(hostHome, ".local", "share", "opencode"), {
      recursive: true,
    });
    await writeFile(
      join(hostHome, ".local", "share", "opencode", "auth.json"),
      '{"ok":true}\n',
      { mode: 0o600 },
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(input).endsWith("/v1/me/github-credentials")) {
        return new Response(
          JSON.stringify({ error: "GitHub App is not configured" }),
          { status: 503 },
        );
      }
      return new Response("error", { status: 500 });
    });
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await doctorCommand({
      configDir,
      fetch: fetchMock as typeof fetch,
      stdout,
      env: { PATH: `${binDir}:${process.env.PATH ?? ""}`, HOME: hostHome },
      hostHome,
    });
    const output = chunks.join("");
    expect(output).toContain("opencode が PATH にあります");
    expect(output).toContain("OpenCode 認証: ホストの opencode auth を引き継ぎます");
    expect(output).not.toContain("Claude Code CLI が見つかりません");
    expect(output).not.toContain("エンジン: fake");
  });

  it("reports that a host claude login will be inherited", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    const hostHome = await mkdtemp(join(tmpdir(), "comitia-doctor-home-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    cleanups.push(() => rm(hostHome, { recursive: true }));
    await writeConfig(configDir);
    await mkdir(join(hostHome, ".claude"), { recursive: true });
    await writeFile(
      join(hostHome, ".claude", ".credentials.json"),
      '{"claudeAiOauth":{}}',
      { mode: 0o600 },
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(input).endsWith("/v1/me/github-credentials")) {
        return new Response(
          JSON.stringify({ error: "GitHub App is not configured" }),
          { status: 503 },
        );
      }
      return new Response("error", { status: 500 });
    });
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await doctorCommand({
      configDir,
      fetch: fetchMock as typeof fetch,
      stdout,
      env: {},
      hostHome,
    });
    expect(chunks.join("")).toContain("Claude 認証: ホストの claude login を引き継ぎます");
  });

  it("surfaces a missing GitHub App installation as a doctor failure", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/v1/project")) {
        return new Response(
          JSON.stringify({
            name: "comitia",
            repoUrl: "https://github.com/hskksk/comitia",
            githubOwner: null,
            githubRepo: null,
            githubInstallationId: null,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/v1/me/github-credentials")) {
        return new Response(
          JSON.stringify({ error: "project has no GitHub App installation" }),
          { status: 404 },
        );
      }
      return new Response("error", { status: 500 });
    });
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await doctorCommand({ configDir, fetch: fetchMock as typeof fetch, stdout });
    const output = chunks.join("");
    expect(output).toContain("GitHub App: プロジェクト未接続");
    expect(output).toContain("GitHub 実行資格: プロジェクトに GitHub App が未接続");
    expect(output).toContain("✗");
  });

  it("reports GitHub credential minting without printing the token", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(input).endsWith("/v1/me/github-credentials")) {
        return new Response(
          JSON.stringify({
            token: "ghs_secret_should_not_appear",
            expiresAt: "2026-08-22T10:00:00.000Z",
            owner: "hskksk",
            repo: "comitia",
            repoUrl: "https://github.com/hskksk/comitia",
          }),
          { status: 200 },
        );
      }
      return new Response("error", { status: 500 });
    });
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await doctorCommand({ configDir, fetch: fetchMock as typeof fetch, stdout });
    const output = chunks.join("");
    expect(output).toContain("GitHub 実行資格: 発行できる（hskksk/comitia）");
    expect(output).not.toContain("ghs_secret_should_not_appear");
  });

  it("surfaces a 502 GitHub mint error without printing a token", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(input).endsWith("/v1/me/github-credentials")) {
        return new Response(
          JSON.stringify({
            error:
              "GitHub App is missing Contents write or Pull requests write, or the installation has not been re-approved after a permission change",
          }),
          { status: 502 },
        );
      }
      return new Response("error", { status: 500 });
    });
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await doctorCommand({ configDir, fetch: fetchMock as typeof fetch, stdout });
    const output = chunks.join("");
    expect(output).toContain("GitHub 実行資格: 発行に失敗（502");
    expect(output).toContain("Contents write");
    expect(output).not.toContain("ghs_");
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

  it("prints the latest session chat log", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/agents/agent-1/sessions")) {
        return new Response(
          JSON.stringify({
            items: [{ id: "sess-1", startedAt: "2026-08-17T00:00:00.000Z", endedAt: null }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/sessions/sess-1/chat-log")) {
        return new Response(
          JSON.stringify({ chatLog: "hello from mika\n", truncated: false }),
          { status: 200 },
        );
      }
      return new Response("error", { status: 500 });
    });

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await agentLogsCommand({
      name: "mika",
      follow: false,
      configDir,
      fetch: fetchMock as typeof fetch,
      stdout,
    });

    expect(chunks.join("")).toContain("hello from mika");
  });

  it("prints rich trace lines from chat log by default", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-logs-rich-"));
    cleanups.push(() => rm(configDir, { recursive: true, force: true }));
    await writeConfig(configDir);

    const traceLine = `@json ${JSON.stringify({
      v: 1,
      seq: 1,
      at: "2026-08-31T11:00:00.000Z",
      kind: "tool_call",
      run: 1,
      tool: "get_briefing",
      args: {},
    })}`;

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/agents/agent-1/sessions")) {
        return new Response(
          JSON.stringify({
            items: [{ id: "sess-1", startedAt: "2026-08-17T00:00:00.000Z", endedAt: null }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/sessions/sess-1/chat-log")) {
        return new Response(
          JSON.stringify({ chatLog: `${traceLine}\n`, truncated: false }),
          { status: 200 },
        );
      }
      return new Response("error", { status: 500 });
    });

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await agentLogsCommand({
      name: "mika",
      follow: false,
      configDir,
      fetch: fetchMock as typeof fetch,
      stdout,
    });

    expect(chunks.join("")).toContain("[tool] get_briefing({})");
    expect(chunks.join("")).not.toContain("@json");
  });

  it("prints raw chat log with --raw", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-logs-raw-"));
    cleanups.push(() => rm(configDir, { recursive: true, force: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/agents/agent-1/sessions")) {
        return new Response(
          JSON.stringify({
            items: [{ id: "sess-1", startedAt: "2026-08-17T00:00:00.000Z", endedAt: null }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/sessions/sess-1/chat-log")) {
        return new Response(
          JSON.stringify({ chatLog: "hello from mika\n", truncated: false }),
          { status: 200 },
        );
      }
      return new Response("error", { status: 500 });
    });

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await agentLogsCommand({
      name: "mika",
      follow: false,
      raw: true,
      configDir,
      fetch: fetchMock as typeof fetch,
      stdout,
    });

    expect(chunks.join("")).toContain("hello from mika");
  });
});
