import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClaudeArgs,
  buildClaudeRunEnv,
  buildMcpConfig,
  commandExists,
  createClaudeCodePlugin,
  parseClaudeStream,
  resolveMcpStdioEntrypoint,
} from "./claude-code.js";
import { TOOLSET_OVERVIEW } from "./tool-catalog.js";

describe("buildClaudeArgs", () => {
  it("uses isolated MCP with bypass permissions and stream JSON", () => {
    expect(
      buildClaudeArgs({
        prompt: "work on the briefing",
        mcpConfigPath: "/tmp/mcp-config.json",
      }),
    ).toEqual([
      "-p",
      "work on the briefing",
      "--mcp-config",
      "/tmp/mcp-config.json",
      "--strict-mcp-config",
      "--setting-sources",
      "project,local",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "claude-sonnet-5",
    ]);
  });

  it("does not pass --bare so a host claude login can be inherited", () => {
    expect(
      buildClaudeArgs({
        prompt: "continue",
        mcpConfigPath: "/tmp/mcp-config.json",
      }),
    ).not.toContain("--bare");
  });

  it("skips user settings so host hooks and plugins stay out of the session", () => {
    const args = buildClaudeArgs({
      prompt: "continue",
      mcpConfigPath: "/tmp/mcp-config.json",
    });
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project,local");
  });

  it("appends a system prompt when given one", () => {
    const args = buildClaudeArgs({
      prompt: "continue",
      mcpConfigPath: "/tmp/mcp-config.json",
      appendSystemPrompt: TOOLSET_OVERVIEW,
    });
    const flagIndex = args.indexOf("--append-system-prompt");
    expect(flagIndex).toBeGreaterThan(-1);
    expect(args[flagIndex + 1]).toBe(TOOLSET_OVERVIEW);
  });

  it("omits --append-system-prompt when no system prompt is given", () => {
    expect(
      buildClaudeArgs({
        prompt: "continue",
        mcpConfigPath: "/tmp/mcp-config.json",
      }),
    ).not.toContain("--append-system-prompt");
  });
});


describe("parseClaudeStream", () => {
  it("extracts assistant text and normalizes MCP tool names", () => {
    const output = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "briefing loaded" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "mcp__comitia-board__get_briefing",
              input: {},
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "text", text: "raw user message" },
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: [{ type: "text", text: '{"remaining_budget":7}' }],
            },
          ],
        },
      }),
    ].join("\n");

    expect(parseClaudeStream(output, 2)).toMatchObject({
      transcript: "briefing loaded",
      remainingBudget: 7,
      toolLog: [{ run: 2, tool: "get_briefing", args: {} }],
    });
  });
});


describe("buildMcpConfig", () => {
  it("marks the board proxy as alwaysLoad so tools are present on the first turn", () => {
    expect(
      buildMcpConfig({
        command: "/usr/bin/node",
        args: ["/tmp/mcp-stdio-main.js"],
        env: {
          COMITIA_BOARD_URL: "http://127.0.0.1:9",
          COMITIA_AGENT_TOKEN: "t",
        },
      }),
    ).toEqual({
      mcpServers: {
        "comitia-board": {
          command: "/usr/bin/node",
          args: ["/tmp/mcp-stdio-main.js"],
          env: {
            COMITIA_BOARD_URL: "http://127.0.0.1:9",
            COMITIA_AGENT_TOKEN: "t",
          },
          alwaysLoad: true,
        },
      },
    });
  });
});


describe("buildClaudeRunEnv", () => {
  it("keeps the host HOME and isolates git without remapping it", () => {
    const env = buildClaudeRunEnv(
      "/tmp/isolated-home",
      null,
      { PATH: "/bin", HOME: "/Users/haru" },
      "/Users/haru",
    );
    expect(env).toMatchObject({
      HOME: "/Users/haru",
      MCP_CONNECTION_NONBLOCKING: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
    expect(env.GIT_CONFIG_GLOBAL).toBe(devNull);
    expect(env.HOME).not.toBe("/tmp/isolated-home");
  });

  it("points git at the isolated gitconfig when an installation token is minted", () => {
    const env = buildClaudeRunEnv(
      "/tmp/isolated-home",
      "ghs_minted",
      { PATH: "/bin", HOME: "/Users/haru" },
      "/Users/haru",
    );
    expect(env.HOME).toBe("/Users/haru");
    expect(env.GIT_CONFIG_GLOBAL).toBe(join("/tmp/isolated-home", ".gitconfig"));
    expect(env.GH_TOKEN).toBe("ghs_minted");
  });

  it("leaves CLAUDE_CONFIG_DIR unset so macOS Keychain stays on the host login", () => {
    const env = buildClaudeRunEnv(
      "/tmp/isolated-home",
      null,
      {
        PATH: "/bin",
        HOME: "/Users/haru",
        CLAUDE_CONFIG_DIR: "/Users/haru/.claude",
      },
      "/Users/haru",
    );
    expect(env.HOME).toBe("/Users/haru");
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBeUndefined();
  });

  it("does not export an empty CLAUDE_SECURESTORAGE_CONFIG_DIR pin", () => {
    const env = buildClaudeRunEnv("/tmp/isolated-home", null, { PATH: "/bin" });
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBeUndefined();
  });

  it("keeps a custom host profile as the secure-storage pin only", () => {
    const env = buildClaudeRunEnv("/tmp/isolated-home", null, {
      PATH: "/bin",
      CLAUDE_CONFIG_DIR: "/host/.claude-work",
    });
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe("/host/.claude-work");
  });

  it("keeps an explicit host CLAUDE_SECURESTORAGE_CONFIG_DIR", () => {
    const env = buildClaudeRunEnv("/tmp/isolated-home", null, {
      PATH: "/bin",
      CLAUDE_SECURESTORAGE_CONFIG_DIR: "/custom-store",
    });
    expect(env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe("/custom-store");
  });

  it("overrides a host GH_TOKEN with the minted installation token", () => {
    const env = buildClaudeRunEnv("/tmp/isolated-home", "ghs_minted", {
      GH_TOKEN: "github_pat_host",
      GITHUB_TOKEN: "host-other",
      PATH: "/bin",
    });
    expect(env.GH_TOKEN).toBe("ghs_minted");
    expect(env.GITHUB_TOKEN).toBe("ghs_minted");
  });

  it("strips host GitHub tokens when none were minted", () => {
    const env = buildClaudeRunEnv("/tmp/isolated-home", null, {
      GH_TOKEN: "github_pat_host",
      GITHUB_TOKEN: "host-other",
      PATH: "/bin",
    });
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });
});


describe("resolveMcpStdioEntrypoint", () => {
  it("points at the published comitia-mcp-proxy bin", () => {
    expect(resolveMcpStdioEntrypoint()).toBe(
      join(import.meta.dirname, "../../dist/mcp-stdio-main.js"),
    );
  });
});


describe("createClaudeCodePlugin work dir ownership", () => {
  it("keeps a persistent work dir after stop()", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "comitia-workdir-persist-"));
    const plugin = createClaudeCodePlugin({ hostEnv: {}, hostHome: workDir });
    await plugin.start({
      sessionId: "persist-test",
      workDir,
      workDirPersistent: true,
      mcp: { command: process.execPath, args: [], env: {} },
    });
    await plugin.stop();
    expect(existsSync(workDir)).toBe(true);
    await plugin.dispose();
    await rm(workDir, { recursive: true, force: true });
  });

  it("deletes a non-persistent work dir after stop()", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "comitia-workdir-temp-"));
    const plugin = createClaudeCodePlugin({ hostEnv: {}, hostHome: workDir });
    await plugin.start({
      sessionId: "temp-test",
      workDir,
      workDirPersistent: false,
      mcp: { command: process.execPath, args: [], env: {} },
    });
    await plugin.stop();
    expect(existsSync(workDir)).toBe(false);
    await plugin.dispose();
  });

  it("reuses the isolated gitconfig dir across sessions until dispose()", async () => {
    const countIsolatedHomes = async () => {
      const entries = await readdir(tmpdir());
      return entries.filter((name) => name.startsWith("comitia-claude-home-"))
        .length;
    };
    const workDir = await mkdtemp(join(tmpdir(), "comitia-workdir-home-"));
    const plugin = createClaudeCodePlugin({ hostEnv: {}, hostHome: workDir });
    const session = {
      workDir,
      workDirPersistent: true,
      mcp: { command: process.execPath, args: [], env: {} },
    };
    const before = await countIsolatedHomes();

    await plugin.start({ ...session, sessionId: "home-test-1" });
    await plugin.stop();
    expect(await countIsolatedHomes()).toBe(before + 1);

    await plugin.start({ ...session, sessionId: "home-test-2" });
    await plugin.stop();
    expect(await countIsolatedHomes()).toBe(before + 1);

    await plugin.dispose();
    expect(await countIsolatedHomes()).toBe(before);
    await rm(workDir, { recursive: true, force: true });
  });

  it("does not copy host claude credentials into the git isolation dir", async () => {
    const hostHome = await mkdtemp(join(tmpdir(), "comitia-host-claude-"));
    const workDir = await mkdtemp(join(tmpdir(), "comitia-workdir-auth-"));
    await mkdir(join(hostHome, ".claude"), { recursive: true });
    await writeFile(
      join(hostHome, ".claude", ".credentials.json"),
      '{"claudeAiOauth":{"accessToken":"from-host"}}',
      { mode: 0o600 },
    );
    const plugin = createClaudeCodePlugin({ hostEnv: {}, hostHome });
    const before = new Set(await readdir(tmpdir()));

    await plugin.start({
      sessionId: "auth-seed-test",
      workDir,
      workDirPersistent: true,
      mcp: { command: process.execPath, args: [], env: {} },
    });

    const created = (await readdir(tmpdir())).filter(
      (name) => name.startsWith("comitia-claude-home-") && !before.has(name),
    );
    expect(created).toHaveLength(1);
    expect(existsSync(join(tmpdir(), created[0]!, ".claude"))).toBe(false);

    await plugin.dispose();
    await rm(workDir, { recursive: true, force: true });
    await rm(hostHome, { recursive: true, force: true });
  });
});

describe("Claude Code live CLI", () => {
  it.skipIf(process.env.COMITIA_LIVE_CLAUDE !== "1")(
    "calls get_briefing through the real Claude CLI",
    async (context) => {
      if (!commandExists("claude")) context.skip();

      execFileSync("pnpm", ["--filter", "@comitia/agent", "build"], {
        cwd: join(import.meta.dirname, "../../../.."),
        stdio: "inherit",
      });

      const requests: string[] = [];
      const server = createServer((request, response) => {
        requests.push(request.url ?? "");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ remaining_budget: 7, goals: [] }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Live test server did not bind to a TCP port");
      }

      const workDir = await mkdtemp(join(tmpdir(), "comitia-live-claude-"));
      const plugin = createClaudeCodePlugin();

      try {
        await plugin.start({
          sessionId: "live-claude-test",
          workDir,
          workDirPersistent: false,
          mcp: {
            command: process.execPath,
            args: [],
            env: {
              COMITIA_BOARD_URL: `http://127.0.0.1:${address.port}`,
              COMITIA_AGENT_TOKEN: "live-test-token",
            },
          },
        });
        const result = await plugin.run(
          "Call the comitia-board get_briefing tool exactly once, then briefly summarize it.",
        );

        expect(
          requests,
          `expected get_briefing HTTP call; transcript=${result.transcript} toolLog=${JSON.stringify(result.toolLog)}`,
        ).toContain("/v1/tools/get_briefing");
        expect(result.toolLog).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ tool: "get_briefing" }),
          ]),
        );
      } finally {
        await plugin.stop();
        await plugin.dispose();
        await rm(workDir, { recursive: true, force: true });
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    300_000,
  );
});
