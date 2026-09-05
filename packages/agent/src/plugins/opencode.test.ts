import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createEnginePlugin } from "./create-engine.js";
import {
  bayEventToTracePartial,
  createOpencodePlugin,
  githubAuthToExtraEnv,
} from "./opencode.js";
import { TraceSessionLog } from "../trace-format.js";

const FAKE_OPENCODE = join(
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

async function fakeOpencodeEnv(hostHome: string): Promise<NodeJS.ProcessEnv> {
  const binDir = await tempDir("comitia-opencode-bin-");
  const dest = join(binDir, "opencode");
  await chmod(FAKE_OPENCODE, 0o755);
  await symlink(FAKE_OPENCODE, dest);
  await chmod(dest, 0o755);
  await mkdir(join(hostHome, ".local", "share", "opencode"), { recursive: true });
  await writeFile(
    join(hostHome, ".local", "share", "opencode", "auth.json"),
    '{"ok":true}\n',
    "utf8",
  );
  return {
    HOME: hostHome,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
}

describe("bayEventToTracePartial", () => {
  it("maps bay events onto Comitia trace kinds and remaining_budget", () => {
    expect(bayEventToTracePartial({ kind: "text", text: "hi" }, 2)).toEqual({
      kind: "text",
      text: "hi",
      run: 2,
    });
    expect(
      bayEventToTracePartial(
        {
          kind: "tool_result",
          callId: "c1",
          tool: "get_briefing",
          ok: true,
          result: '{"remaining_budget":11}',
        },
        3,
      ),
    ).toMatchObject({
      kind: "tool_result",
      tool: "get_briefing",
      remainingBudget: 11,
      run: 3,
    });
    expect(bayEventToTracePartial({ kind: "exit", code: 0 }, 1)).toBeNull();
  });
});

describe("githubAuthToExtraEnv", () => {
  it("passes minted tokens and omits them when absent", () => {
    expect(
      githubAuthToExtraEnv({
        token: "ghs_minted",
        expiresAt: "2030-01-01T00:00:00.000Z",
        committerName: "mika",
      }),
    ).toEqual({ GH_TOKEN: "ghs_minted", GITHUB_TOKEN: "ghs_minted" });
    expect(githubAuthToExtraEnv(null)).toEqual({});
  });
});

describe("createEnginePlugin", () => {
  it("builds an OpenCode plugin for --engine opencode", () => {
    const plugin = createEnginePlugin({
      engine: "opencode",
      callTool: async () => ({ content: [] }),
    });
    expect(plugin.updateGithubAuth).toBeTypeOf("function");
    expect(plugin.run).toBeTypeOf("function");
  });
});

describe("createOpencodePlugin", () => {
  it("runs a fake opencode, maps tools, and keeps a persistent work dir", async () => {
    const hostHome = await tempDir("comitia-opencode-home-");
    const workDir = await tempDir("comitia-opencode-work-");
    await writeFile(join(workDir, "keep.txt"), "ok\n", "utf8");
    const hostEnv = await fakeOpencodeEnv(hostHome);
    hostEnv.ENGINEBAY_FAKE_EVENTS = [
      JSON.stringify({
        type: "text",
        part: { type: "text", text: "briefing next" },
      }),
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "mcp__comitia-board__get_briefing",
          callID: "c1",
          state: {
            status: "completed",
            input: {},
            output: '{"remaining_budget":42}',
          },
        },
      }),
      JSON.stringify({
        type: "step_finish",
        tokens: { input: 1, output: 2, total: 3 },
      }),
    ].join("\n");

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    const plugin = createOpencodePlugin({ hostEnv, hostHome, stdout });
    await plugin.start({
      sessionId: "sess-oc",
      workDir,
      workDirPersistent: true,
      environmentPrompt: "あなたは ミカ@ハル である。",
      mcp: { command: process.execPath, args: [], env: {} },
      github: {
        token: "ghs_mintedtokenvalue",
        expiresAt: "2030-01-01T00:00:00.000Z",
        committerName: "ミカ@ハル",
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
    expect((await plugin.report()).tokens).toBe(3);
    expect(chunks.join("")).toContain("briefing next");
    expect(chunks.join("")).toContain("get_briefing");
    expect(existsSync(join(workDir, "AGENTS.md"))).toBe(false);

    await plugin.stop();
    expect(existsSync(join(workDir, "keep.txt"))).toBe(true);
    await plugin.dispose();
    expect(existsSync(join(workDir, "keep.txt"))).toBe(true);
  });

  it("throws when the fake CLI exits non-zero", async () => {
    const hostHome = await tempDir("comitia-opencode-home-");
    const workDir = await tempDir("comitia-opencode-work-");
    const hostEnv = await fakeOpencodeEnv(hostHome);
    hostEnv.ENGINEBAY_FAKE_EXIT = "2";
    const plugin = createOpencodePlugin({ hostEnv, hostHome });
    await plugin.start({
      sessionId: "sess-fail",
      workDir,
      workDirPersistent: true,
      mcp: { command: process.execPath, args: [], env: {} },
    });
    await expect(plugin.run("go")).rejects.toThrow(/opencode exited with code 2/);
    await plugin.dispose();
  });

  it("deletes a non-persistent work dir after stop()", async () => {
    const hostHome = await tempDir("comitia-opencode-home-");
    const workDir = await tempDir("comitia-opencode-work-");
    const plugin = createOpencodePlugin({
      hostEnv: await fakeOpencodeEnv(hostHome),
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

  it("passes --model when set, same override as Cursor Agent", async () => {
    const hostHome = await tempDir("comitia-opencode-model-home-");
    const workDir = await tempDir("comitia-opencode-model-work-");
    const dumpDir = await tempDir("comitia-opencode-model-dump-");
    const hostEnv = await fakeOpencodeEnv(hostHome);
    hostEnv.ENGINEBAY_DUMP_DIR = dumpDir;
    const plugin = createOpencodePlugin({
      hostEnv,
      hostHome,
      model: "opencode/gpt-5",
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
    expect(argv).toEqual(expect.arrayContaining(["--model", "opencode/gpt-5"]));
    await plugin.dispose();
  });
});
