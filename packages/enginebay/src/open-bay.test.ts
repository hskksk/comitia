import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doctor, openBay } from "./open-bay.js";
import type { IsolationKind } from "./types.js";
import {
  installFakeOpencode,
  withFakePath,
  writeHostOpencodeAuth,
} from "./test/fake-opencode.js";

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

async function collectEvents(
  bay: Awaited<ReturnType<typeof openBay>>,
  prompt: string,
) {
  const events = [];
  for await (const event of bay.run(prompt)) {
    events.push(event);
  }
  return events;
}

describe("openBay OpenCode isolation", () => {
  it("spawns a fake opencode with isolated XDG, inherited auth, and no host config writes", async () => {
    const hostHome = await tempDir("enginebay-host-");
    const workDir = await tempDir("enginebay-work-");
    const binDir = await tempDir("enginebay-bin-");
    const dumpDir = await tempDir("enginebay-dump-");
    await installFakeOpencode(binDir);
    await writeHostOpencodeAuth(hostHome);
    await writeFile(
      join(hostHome, ".local", "share", "opencode", "session.db"),
      "host-session",
      "utf8",
    );
    const hostConfigDir = join(hostHome, ".config", "opencode");
    await mkdir(hostConfigDir, { recursive: true });
    await writeFile(join(hostConfigDir, "config.json"), '{"host":true}\n', "utf8");
    await writeFile(join(workDir, "keep.txt"), "workspace\n", "utf8");

    const hostEnv = withFakePath(binDir, {
      HOME: hostHome,
      PATH: process.env.PATH,
      GH_TOKEN: "github_pat_host",
      GITHUB_TOKEN: "host-other",
    });

    const bay = await openBay({
      engine: "opencode",
      workDir,
      hostHome,
      hostEnv,
      instructions: "You are in a bay.",
      mcp: {
        command: process.execPath,
        args: ["/tmp/mcp.js"],
        env: { BOARD_URL: "http://127.0.0.1:9" },
        name: "comitia-board",
      },
      extraEnv: {
        ENGINEBAY_DUMP_DIR: dumpDir,
        GH_TOKEN: "ghs_mintedtokenvalue",
      },
      git: { committerName: "bay-bot" },
      model: "opencode/big-pickle",
    });

    const events = await collectEvents(bay, "read the briefing");
    expect(events.map((event) => event.kind)).toEqual(["text", "exit"]);
    expect(events[0]).toEqual({ kind: "text", text: "ok" });
    expect(events.at(-1)).toEqual({ kind: "exit", code: 0 });

    const argv = JSON.parse(
      await readFile(join(dumpDir, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).toEqual([
      "run",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--dir",
      workDir,
      "--model",
      "opencode/big-pickle",
      "read the briefing",
    ]);

    const dumped = JSON.parse(
      await readFile(join(dumpDir, "env.json"), "utf8"),
    ) as {
      HOME: string;
      XDG_CONFIG_HOME: string;
      XDG_DATA_HOME: string;
      XDG_CONFIG_DIRS: string;
      OPENCODE_DISABLE_GLOBAL_CONFIG: string;
      OPENCODE_DISABLE_CLAUDE_CODE: string;
      OPENCODE_CONFIG_CONTENT: string;
      GH_TOKEN: string;
      GITHUB_TOKEN?: string;
      GIT_CONFIG_GLOBAL: string;
      isolatedShareFiles: string[];
    };
    expect(dumped.HOME).not.toBe(hostHome);
    expect(dumped.XDG_CONFIG_HOME).not.toBe(join(hostHome, ".config"));
    expect(dumped.XDG_CONFIG_DIRS).toBe("");
    expect(dumped.OPENCODE_DISABLE_GLOBAL_CONFIG).toBe("1");
    expect(dumped.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect(dumped.GH_TOKEN).toBe("ghs_mintedtokenvalue");
    expect(dumped.GITHUB_TOKEN).toBeUndefined();
    expect(dumped.isolatedShareFiles).toContain("auth.json");
    expect(dumped.isolatedShareFiles).not.toContain("session.db");

    const config = JSON.parse(dumped.OPENCODE_CONFIG_CONTENT) as {
      mcp: Record<string, { command: string[] }>;
      instructions: string[];
    };
    expect(config.mcp["comitia-board"]?.command).toEqual([
      process.execPath,
      "/tmp/mcp.js",
    ]);
    expect(config.instructions).toHaveLength(1);
    expect(await readFile(config.instructions[0]!, "utf8")).toBe(
      "You are in a bay.",
    );

    const gitconfig = await readFile(dumped.GIT_CONFIG_GLOBAL, "utf8");
    expect(gitconfig).toContain("name = bay-bot");
    expect(gitconfig).toContain("enginebay@users.noreply.github.com");

    expect(await readFile(join(hostConfigDir, "config.json"), "utf8")).toBe(
      '{"host":true}\n',
    );
    expect(existsSync(join(workDir, "AGENTS.md"))).toBe(false);

    await bay.close();
    expect(existsSync(join(workDir, "keep.txt"))).toBe(true);
    expect(existsSync(dumped.HOME)).toBe(false);
    expect(existsSync(dumped.XDG_DATA_HOME)).toBe(false);
  });

  it("redacts secrets from streamed events and yields stderr diagnostics", async () => {
    const hostHome = await tempDir("enginebay-host-");
    const workDir = await tempDir("enginebay-work-");
    const binDir = await tempDir("enginebay-bin-");
    await installFakeOpencode(binDir);
    await writeHostOpencodeAuth(hostHome);

    const bay = await openBay({
      engine: "opencode",
      workDir,
      hostHome,
      hostEnv: withFakePath(binDir, {
        HOME: hostHome,
        PATH: process.env.PATH,
        ENGINEBAY_FAKE_EVENTS: JSON.stringify({
          type: "text",
          part: { type: "text", text: "token ghs_LIVESECRET99" },
        }),
        ENGINEBAY_FAKE_STDERR: "Bearer abc.def leaked\n",
      }),
    });
    const events = await collectEvents(bay, "go");
    await bay.close();
    expect(events).toContainEqual({
      kind: "text",
      text: "token [redacted]",
    });
    expect(events).toContainEqual({
      kind: "diagnostic",
      stream: "stderr",
      text: "[redacted] leaked",
    });
    expect(JSON.stringify(events)).not.toContain("ghs_LIVESECRET99");
    expect(JSON.stringify(events)).not.toContain("Bearer abc.def");
  });

  it("does not throw when host auth is missing", async () => {
    const hostHome = await tempDir("enginebay-host-");
    const workDir = await tempDir("enginebay-work-");
    const binDir = await tempDir("enginebay-bin-");
    await installFakeOpencode(binDir);
    const bay = await openBay({
      engine: "opencode",
      workDir,
      hostHome,
      hostEnv: withFakePath(binDir, { HOME: hostHome, PATH: process.env.PATH }),
    });
    const events = await collectEvents(bay, "go");
    await bay.close();
    expect(events.at(-1)).toEqual({ kind: "exit", code: 0 });
  });
});

describe("openBay guards", () => {
  it("rejects unimplemented engines and isolation backends", async () => {
    await expect(
      openBay({ engine: "claude-code", workDir: "/tmp/work" }),
    ).rejects.toThrow(/not implemented yet/);
    await expect(
      openBay({
        engine: "opencode",
        workDir: "/tmp/work",
        isolation: { kind: "jai" as IsolationKind },
      }),
    ).rejects.toThrow(/isolation jai is not implemented/);
  });
});

describe("doctor", () => {
  it("reports a missing CLI in English and does not claim claude-code works", async () => {
    const emptyPath = await tempDir("enginebay-empty-path-");
    const report = await doctor("opencode", {
      env: { PATH: emptyPath, HOME: emptyPath },
      home: emptyPath,
    });
    expect(report.ok).toBe(false);
    expect(report.cli.found).toBe(false);
    expect(report.message).toMatch(/opencode CLI is not on PATH/);
    expect(report.auth.found).toBe(false);

    const unimplemented = await doctor("claude-code");
    expect(unimplemented.ok).toBe(false);
    expect(unimplemented.message).toMatch(/not implemented yet/);
  });

  it("finds a fake CLI and host auth files", async () => {
    const hostHome = await tempDir("enginebay-host-");
    const binDir = await tempDir("enginebay-bin-");
    await installFakeOpencode(binDir);
    await writeHostOpencodeAuth(hostHome);
    const report = await doctor("opencode", {
      env: withFakePath(binDir, { HOME: hostHome, PATH: process.env.PATH }),
      home: hostHome,
    });
    expect(report.ok).toBe(true);
    expect(report.cli.found).toBe(true);
    expect(report.cli.version).toBe("1.0.0-fake");
    expect(report.auth.found).toBe(true);
    expect(report.message).toMatch(/auth files present/);
  });
});
