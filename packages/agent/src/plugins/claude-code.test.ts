import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClaudeArgs,
  buildClaudeRunEnv,
  buildMcpConfig,
  commandExists,
  createClaudeCodePlugin,
  formatClaudeStreamLineForConsole,
  parseClaudeStream,
  processClaudeStreamChunk,
  resolveMcpStdioEntrypoint,
} from "./claude-code.js";
import { TOOLSET_OVERVIEW } from "./tool-catalog.js";

describe("buildClaudeArgs", () => {
  it("uses isolated MCP with bypass permissions and stream JSON", () => {
    expect(
      buildClaudeArgs({
        prompt: "work on the briefing",
        mcpConfigPath: "/tmp/mcp-config.json",
        hasBare: false,
      }),
    ).toEqual([
      "-p",
      "work on the briefing",
      "--mcp-config",
      "/tmp/mcp-config.json",
      "--strict-mcp-config",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "claude-sonnet-5",
    ]);
  });

  it("uses --bare when the installed Claude CLI supports it", () => {
    expect(
      buildClaudeArgs({
        prompt: "continue",
        mcpConfigPath: "/tmp/mcp-config.json",
        hasBare: true,
      }),
    ).toContain("--bare");
  });

  it("appends a system prompt when given one", () => {
    const args = buildClaudeArgs({
      prompt: "continue",
      mcpConfigPath: "/tmp/mcp-config.json",
      hasBare: false,
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
        hasBare: false,
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


describe("processClaudeStreamChunk", () => {
  it("emits complete lines and carries the remainder forward", () => {
    const lines: string[] = [];
    let buffer = processClaudeStreamChunk("", "line-1\nline-2\npart", (line) =>
      lines.push(line),
    );
    expect(lines).toEqual(["line-1", "line-2"]);
    expect(buffer).toBe("part");

    buffer = processClaudeStreamChunk(buffer, "ial\nline-4\n", (line) =>
      lines.push(line),
    );
    expect(lines).toEqual(["line-1", "line-2", "partial", "line-4"]);
    expect(buffer).toBe("");
  });

  it("keeps buffering when no newline has arrived yet", () => {
    const lines: string[] = [];
    const buffer = processClaudeStreamChunk("no-newline-yet", "-still-none", (line) =>
      lines.push(line),
    );
    expect(lines).toEqual([]);
    expect(buffer).toBe("no-newline-yet-still-none");
  });
});

describe("formatClaudeStreamLineForConsole", () => {
  it("returns null for blank lines and non-JSON noise", () => {
    expect(formatClaudeStreamLineForConsole("")).toBeNull();
    expect(formatClaudeStreamLineForConsole("   ")).toBeNull();
    expect(formatClaudeStreamLineForConsole("not json")).toBeNull();
  });

  it("returns null for non-assistant events", () => {
    expect(
      formatClaudeStreamLineForConsole(
        JSON.stringify({ type: "user", message: { content: [] } }),
      ),
    ).toBeNull();
  });

  it("formats thinking blocks with a [thinking] prefix", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "thinking", thinking: "considering the options" }],
      },
    });
    expect(formatClaudeStreamLineForConsole(line)).toBe(
      "[thinking] considering the options",
    );
  });

  it("formats plain assistant text as-is", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello there" }] },
    });
    expect(formatClaudeStreamLineForConsole(line)).toBe("hello there");
  });

  it("formats tool_use with a normalized tool name and args", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "mcp__comitia-board__get_briefing",
            input: { foo: "bar" },
          },
        ],
      },
    });
    expect(formatClaudeStreamLineForConsole(line)).toBe(
      '[tool] get_briefing({"foo":"bar"})',
    );
  });

  it("joins multiple content blocks with newlines", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "ok" },
        ],
      },
    });
    expect(formatClaudeStreamLineForConsole(line)).toBe("[thinking] hmm\nok");
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
  it("forces a blocking MCP connect before the first prompt", () => {
    expect(buildClaudeRunEnv("/tmp/isolated-home")).toMatchObject({
      HOME: "/tmp/isolated-home",
      MCP_CONNECTION_NONBLOCKING: "0",
    });
  });

  it("overrides a host GH_TOKEN with the minted installation token", () => {
    const previous = process.env.GH_TOKEN;
    process.env.GH_TOKEN = "github_pat_host";
    try {
      const env = buildClaudeRunEnv("/tmp/isolated-home", "ghs_minted");
      expect(env.GH_TOKEN).toBe("ghs_minted");
      expect(env.GITHUB_TOKEN).toBe("ghs_minted");
    } finally {
      if (previous === undefined) {
        delete process.env.GH_TOKEN;
      } else {
        process.env.GH_TOKEN = previous;
      }
    }
  });

  it("strips host GitHub tokens when none were minted", () => {
    const previousGh = process.env.GH_TOKEN;
    const previousGithub = process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = "github_pat_host";
    process.env.GITHUB_TOKEN = "host-other";
    try {
      const env = buildClaudeRunEnv("/tmp/isolated-home", null);
      expect(env.GH_TOKEN).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
    } finally {
      if (previousGh === undefined) {
        delete process.env.GH_TOKEN;
      } else {
        process.env.GH_TOKEN = previousGh;
      }
      if (previousGithub === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previousGithub;
      }
    }
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
    const plugin = createClaudeCodePlugin();
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
    const plugin = createClaudeCodePlugin();
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

  it("reuses isolated HOME across sessions until dispose()", async () => {
    const countIsolatedHomes = async () => {
      const entries = await readdir(tmpdir());
      return entries.filter((name) => name.startsWith("comitia-claude-home-"))
        .length;
    };
    const workDir = await mkdtemp(join(tmpdir(), "comitia-workdir-home-"));
    const plugin = createClaudeCodePlugin();
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
});

describe("Claude Code live CLI", () => {
  it.skipIf(process.env.COMITIA_LIVE_CLAUDE !== "1")(
    "calls get_briefing through the real Claude CLI",
    async (context) => {
      if (!commandExists("claude")) context.skip();
      if (!process.env.ANTHROPIC_API_KEY) context.skip();

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
