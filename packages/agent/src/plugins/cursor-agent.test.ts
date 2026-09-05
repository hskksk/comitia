import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createEnginePlugin } from "./create-engine.js";
import { createCursorAgentPlugin } from "./cursor-agent.js";
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
  await symlink(FAKE_CLI, join(binDir, "cursor-agent"));
  await chmod(join(binDir, "cursor-agent"), 0o755);
  await mkdir(join(hostHome, ".cursor"), { recursive: true });
  await writeFile(
    join(hostHome, ".cursor", "auth.json"),
    '{"dummy":true}\n',
    { mode: 0o600 },
  );
  return {
    HOME: hostHome,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    ...extra,
  };
}

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
  it("runs a fake cursor-agent, maps tools, and keeps MCP out of the work dir", async () => {
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
    expect(existsSync(join(hostHome, ".cursor", "mcp.json"))).toBe(false);

    const dumpedEnv = JSON.parse(
      await readFile(join(dumpDir, "env.json"), "utf8"),
    ) as {
      HOME: string;
      GH_TOKEN: string;
      CURSOR_CONFIG_DIR?: string;
    };
    expect(dumpedEnv.HOME).toBe(hostHome);
    expect(dumpedEnv.GH_TOKEN).toBe("ghs_mintedtokenvalue");
    expect(dumpedEnv.CURSOR_CONFIG_DIR).toBeTruthy();
    expect(dumpedEnv.CURSOR_CONFIG_DIR).not.toBe(join(hostHome, ".cursor"));
    expect(existsSync(join(dumpedEnv.CURSOR_CONFIG_DIR ?? "", "mcp.json"))).toBe(
      true,
    );
    const attached = join(dumpedEnv.CURSOR_CONFIG_DIR ?? "", "auth.json");
    expect((await lstat(attached)).isSymbolicLink()).toBe(true);
    expect(await readlink(attached)).toBe(join(hostHome, ".cursor", "auth.json"));
    const argv = JSON.parse(
      await readFile(join(dumpDir, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).toContain("--approve-mcps");
    expect(argv).toContain("--workspace");
    expect(argv).toContain(workDir);
    expect(argv).not.toContain("--model");

    await plugin.stop();
    expect(existsSync(join(workDir, "keep.txt"))).toBe(true);
    await plugin.dispose();
    expect(existsSync(join(workDir, "keep.txt"))).toBe(true);
    expect(existsSync(dumpedEnv.CURSOR_CONFIG_DIR ?? "")).toBe(false);
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

  it("passes --model when set, same override as OpenCode", async () => {
    const hostHome = await tempDir("comitia-cursor-model-home-");
    const workDir = await tempDir("comitia-cursor-model-work-");
    const dumpDir = await tempDir("comitia-cursor-model-dump-");
    const plugin = createCursorAgentPlugin({
      hostEnv: await fakeCursorEnv(hostHome, { ENGINEBAY_DUMP_DIR: dumpDir }),
      hostHome,
      model: "composer-2.5",
    });
    await plugin.start({
      sessionId: "sess-model",
      workDir,
      workDirPersistent: true,
      mcp: { command: process.execPath, args: [], env: {} },
    });
    await plugin.run("go");
    const argv = JSON.parse(
      await readFile(join(dumpDir, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).toEqual(expect.arrayContaining(["--model", "composer-2.5"]));
    await plugin.dispose();
  });
});
