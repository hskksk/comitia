import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import { agentTraceCommand } from "./agent-trace.js";
import { saveConfig } from "../config.js";

describe("agentTraceCommand", () => {
  it("prints structured trace entries as human lines", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-trace-"));
    await saveConfig(configDir, {
      boardUrl: "http://127.0.0.1:9",
      ownerToken: "owner-token",
      agents: {
        mika: { agentId: "agent-1", token: "agent-token", engine: "fake" },
      },
    });

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
      if (url.includes("/v1/sessions/sess-1/trace")) {
        return new Response(
          JSON.stringify({
            sessionId: "sess-1",
            hasMore: false,
            entries: [
              {
                v: TRACE_VERSION,
                seq: 1,
                at: "2026-08-31T12:00:00.000Z",
                kind: "tool_call",
                run: 1,
                tool: "get_briefing",
                args: {},
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("error", { status: 500 });
    });

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => chunks.push(String(chunk)));

    await agentTraceCommand({
      name: "mika",
      configDir,
      fetch: fetchMock as typeof fetch,
      stdout,
    });

    expect(chunks.join("")).toContain("[tool] get_briefing({})");
    await rm(configDir, { recursive: true, force: true });
  });
});
