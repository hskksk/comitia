import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createEnginePlugin } from "./create-engine.js";
import {
  buildCursorArgs,
  buildCursorMcpConfig,
  buildCursorRunEnv,
  createCursorAgentPlugin,
  cursorStreamLineToPartialEvents,
  normalizeCursorToolName,
  parseCursorToolCallEnvelope,
} from "./cursor-agent.js";
import { TraceSessionLog } from "../trace-format.js";

const FAKE_CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../test/fake-opencode.mjs",
);

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of [...cleanups].reverse()) {
    await cleanup();
  }
  cleanups.length = 0;
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function fakeCursorEnv(
  hostHome: string,
  extra: NodeJS.ProcessEnv = {},
): Promise<NodeJS.ProcessEnv> {
  const binDir = await tempDir("comitia-cursor-bin-");
  await chmod(FAKE_CLI, 0o755);
  await symlink(FAKE_CLI, join(binDir, "agent"));
  await chmod(join(binDir, "agent"), 0o755);
  return {
    HOME: hostHome,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    CURSOR_API_KEY: "test-cursor-key",
    ...extra,
  };
}

describe("buildCursorArgs", () => {
  it("uses print mode with MCP auto-approve and stream-json", () => {
    expect(
      buildCursorArgs({
        prompt: "read the briefing",
        workDir: "/tmp/work",
        model: "composer-2.5",
      }),
    ).toEqual([
      "-p",
      "read the briefing",
      "--force",
      "--approve-mcps",
      "--trust",
      "--sandbox",
      "disabled",
      "--output-format",
      "stream-json",
      "--workspace",
      "/tmp/work",
      "--model",
      "composer-2.5",
    ]);
  });
});

describe("parseCursorToolCallEnvelope", () => {
  it("reads MCP function payloads and built-in *ToolCall envelopes", () => {
    expect(
      parseCursorToolCallEnvelope({
        function: {
          name: "mcp__comitia-board__get_briefing",
          arguments: "{}",
        },
      }),
    ).toEqual({
      name: "get_briefing",
      args: {},
    });
    expect(
      parseCursorToolCallEnvelope({
        readToolCall: {
          args: { path: "README.md" },
          result: { success: { totalLines: 4 } },
        },
      }),
    ).toEqual({
      name: "read",
      args: { path: "README.md" },
      result: { totalLines: 4 },
    });
  });
});

describe("normalizeCursorToolName", () => {
  it("strips board MCP prefixes", () => {
    expect(normalizeCursorToolName("mcp__comitia-board__get_briefing")).toBe(
      "get_briefing",
    );
    expect(normalizeCursorToolName("get_briefing")).toBe("get_briefing");
  });
});

describe("cursorStreamLineToPartialEvents", () => {
  it("maps assistant text and MCP tool completion onto trace kinds", () => {
    expect(
      cursorStreamLineToPartialEvents(
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "briefing next" }],
          },
        }),
        1,
      ),
    ).toEqual([{ kind: "text", text: "briefing next", run: 1 }]);
    expect(
      cursorStreamLineToPartialEvents(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "c1",
          tool_call: {
            function: {
              name: "mcp__comitia-board__get_briefing",
              arguments: "{}",
              result: '{"remaining_budget":42}',
            },
          },
        }),
        2,
      ),
    ).toMatchObject({
      0: {
        kind: "tool_result",
        tool: "get_briefing",
        remainingBudget: 42,
        run: 2,
      },
    });
  });
});

describe("buildCursorMcpConfig", () => {
  it("injects a session-scoped comitia-board stdio server", () => {
    expect(
      buildCursorMcpConfig({
        command: "/usr/bin/node",
        args: ["proxy.js"],
        env: { COMITIA_BOARD_URL: "http://127.0.0.1:8787" },
      }),
    ).toEqual({
      mcpServers: {
        "comitia-board": {
          command: "/usr/bin/node",
          args: ["proxy.js"],
          env: { COMITIA_BOARD_URL: "http://127.0.0.1:8787" },
        },
      },
    });
  });
});

describe("buildCursorRunEnv", () => {
  it("isolates HOME, passes minted GitHub tokens, and drops the host token", () => {
    const env = buildCursorRunEnv({
      runtimeDir: "/tmp/cursor-runtime",
      githubToken: "ghs_minted",
      hostEnv: {
        HOME: "/home/host",
        GH_TOKEN: "host-secret",
        CURSOR_API_KEY: "user-key",
        PATH: "/bin",
      },
    });
    expect(env.HOME).toBe("/tmp/cursor-runtime");
    expect(env.USERPROFILE).toBe("/tmp/cursor-runtime");
    expect(env.GH_TOKEN).toBe("ghs_minted");
    expect(env.GITHUB_TOKEN).toBe("ghs_minted");
    expect(env.CURSOR_API_KEY).toBe("user-key");
    expect(env.GIT_CONFIG_GLOBAL).toBe("/tmp/cursor-runtime/.gitconfig");
  });
});

describe("createEnginePlugin", () => {
  it("builds a Cursor Agent plugin for --engine cursor-agent", () => {
    const plugin = createEnginePlugin({
      engine: "cursor-agent",
      callTool: async () => ({ content: [] }),
    });
    expect(plugin.updateGithubAuth).toBeTypeOf("function");
    expect(plugin.run).toBeTypeOf("function");
  });
});

describe("createCursorAgentPlugin", () => {
  it("runs a fake agent CLI, maps tools, and keeps MCP out of the work dir", async () => {
    const hostHome = await tempDir("comitia-cursor-home-");
    const workDir = await tempDir("comitia-cursor-work-");
    const dumpDir = await tempDir("comitia-cursor-dump-");
    await writeFile(join(workDir, "keep.txt"), "ok\n", "utf8");
    const hostEnv = await fakeCursorEnv(hostHome, {
      ENGINEBAY_DUMP_DIR: dumpDir,
      ENGINEBAY_FAKE_EVENTS: [
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "briefing next" }],
          },
        }),
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          call_id: "c1",
          tool_call: {
            function: {
              name: "mcp__comitia-board__get_briefing",
              arguments: "{}",
            },
          },
        }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "c1",
          tool_call: {
            function: {
              name: "mcp__comitia-board__get_briefing",
              arguments: "{}",
              result: '{"remaining_budget":42}',
            },
          },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "briefing next",
          duration_ms: 1,
          duration_api_ms: 1,
          session_id: "s1",
        }),
      ].join("\n"),
      GH_TOKEN: "host-secret-must-not-leak",
    });

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    const plugin = createCursorAgentPlugin({ hostEnv, hostHome, stdout });
    await plugin.start({
      sessionId: "sess-cursor",
      workDir,
      workDirPersistent: true,
      environmentPrompt: "あなたは レン@ハル である。",
      mcp: { command: process.execPath, args: [], env: {} },
      github: {
        token: "ghs_mintedtokenvalue",
        expiresAt: "2030-01-01T00:00:00.000Z",
        committerName: "レン@ハル",
      },
    });

    const traceLog = new TraceSessionLog(async () => undefined);
    const result = await plugin.run("read the briefing", {
      run: 1,
      trace: traceLog,
    });
    expect(result.remainingBudget).toBe(42);
    expect(result.toolLog).toEqual([
      expect.objectContaining({ tool: "get_briefing", run: 1 }),
    ]);
    expect(result.traceEvents?.map((event) => event.kind)).toEqual([
      "text",
      "tool_call",
      "tool_result",
    ]);
    expect(chunks.join("")).toContain("briefing next");
    expect(chunks.join("")).toContain("get_briefing");
    expect(existsSync(join(workDir, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(join(workDir, "keep.txt"))).toBe(true);

    const dumpedEnv = JSON.parse(
      await readFile(join(dumpDir, "env.json"), "utf8"),
    ) as {
      HOME: string;
      GH_TOKEN: string;
    };
    expect(dumpedEnv.HOME).not.toBe(hostHome);
    expect(dumpedEnv.GH_TOKEN).toBe("ghs_mintedtokenvalue");
    expect(existsSync(join(dumpedEnv.HOME, ".cursor", "mcp.json"))).toBe(true);
    expect(
      existsSync(join(dumpedEnv.HOME, ".cursor", ".credentials.json")),
    ).toBe(false);
    const argv = JSON.parse(
      await readFile(join(dumpDir, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).toContain("--approve-mcps");
    expect(argv).toContain("--workspace");
    expect(argv).toContain(workDir);

    await plugin.stop();
    expect(existsSync(join(workDir, "keep.txt"))).toBe(true);
    await plugin.dispose();
    expect(existsSync(join(workDir, "keep.txt"))).toBe(true);
    expect(existsSync(dumpedEnv.HOME)).toBe(false);
  });

  it("throws when the fake CLI exits non-zero", async () => {
    const hostHome = await tempDir("comitia-cursor-fail-home-");
    const workDir = await tempDir("comitia-cursor-fail-work-");
    const hostEnv = await fakeCursorEnv(hostHome, { ENGINEBAY_FAKE_EXIT: "2" });
    const plugin = createCursorAgentPlugin({ hostEnv, hostHome });
    await plugin.start({
      sessionId: "sess-fail",
      workDir,
      workDirPersistent: true,
      mcp: { command: process.execPath, args: [], env: {} },
    });
    await expect(plugin.run("go")).rejects.toThrow(
      /cursor-agent exited with code 2/,
    );
    await plugin.dispose();
  });

  it("deletes a non-persistent work dir after stop()", async () => {
    const hostHome = await tempDir("comitia-cursor-tmp-home-");
    const workDir = await tempDir("comitia-cursor-tmp-work-");
    const plugin = createCursorAgentPlugin({
      hostEnv: await fakeCursorEnv(hostHome),
      hostHome,
    });
    await plugin.start({
      sessionId: "sess-tmp",
      workDir,
      workDirPersistent: false,
      mcp: { command: process.execPath, args: [], env: {} },
    });
    await plugin.stop();
    expect(existsSync(workDir)).toBe(false);
    await plugin.dispose();
  });

  it("inherits host agent login via symlink and does not require CURSOR_API_KEY", async () => {
    const hostHome = await tempDir("comitia-cursor-login-home-");
    const workDir = await tempDir("comitia-cursor-login-work-");
    const dumpDir = await tempDir("comitia-cursor-login-dump-");
    await mkdir(join(hostHome, ".cursor"), { recursive: true });
    const hostAuth = join(hostHome, ".cursor", "auth.json");
    await writeFile(hostAuth, '{"dummy":true}\n', { mode: 0o600 });
    const hostEnv = await fakeCursorEnv(hostHome, {
      ENGINEBAY_DUMP_DIR: dumpDir,
    });
    delete hostEnv.CURSOR_API_KEY;

    const plugin = createCursorAgentPlugin({ hostEnv, hostHome });
    await plugin.start({
      sessionId: "sess-login",
      workDir,
      workDirPersistent: true,
      mcp: { command: process.execPath, args: [], env: {} },
    });
    await plugin.run("read the briefing");

    const dumpedEnv = JSON.parse(
      await readFile(join(dumpDir, "env.json"), "utf8"),
    ) as {
      HOME: string;
      CURSOR_API_KEY?: string;
    };
    expect(dumpedEnv.CURSOR_API_KEY).toBeUndefined();
    const attached = join(dumpedEnv.HOME, ".cursor", "auth.json");
    expect((await lstat(attached)).isSymbolicLink()).toBe(true);
    expect(await readlink(attached)).toBe(hostAuth);
    expect(existsSync(join(workDir, ".cursor"))).toBe(false);
    expect(existsSync(join(hostHome, ".cursor", "mcp.json"))).toBe(false);

    await plugin.dispose();
  });
});
