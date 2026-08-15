import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
  parseClaudeStream,
  resolveMcpStdioEntrypoint,
} from "./claude-code.js";

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
  it("forces a blocking MCP connect before the first prompt", () => {
    expect(buildClaudeRunEnv("/tmp/isolated-home")).toMatchObject({
      HOME: "/tmp/isolated-home",
      MCP_CONNECTION_NONBLOCKING: "0",
    });
  });
});


describe("resolveMcpStdioEntrypoint", () => {
  it("points at the published comitia-mcp-proxy bin", () => {
    expect(resolveMcpStdioEntrypoint()).toBe(
      join(import.meta.dirname, "../../dist/mcp-stdio-main.js"),
    );
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
        await rm(workDir, { recursive: true, force: true });
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    300_000,
  );
});
