import type { McpProxyToolResult } from "../mcp-proxy.js";
import type { EnginePlugin } from "./types.js";

export interface FakeScriptStep {
  tool: string;
  args?: Record<string, unknown>;
}

export interface FakeEnginePluginOptions {
  script: FakeScriptStep[];
  callTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<McpProxyToolResult>;
  handover?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseToolJson(
  result: McpProxyToolResult,
): Record<string, unknown> | null {
  const text = result.content[0]?.text;
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function remainingBudgetFrom(
  result: Record<string, unknown> | null,
): number | null {
  if (result && typeof result.remaining_budget === "number") {
    return result.remaining_budget;
  }
  return null;
}

/** In-process engine that replays a script via HTTP MCP proxy. Does not spawn claude. */
export function createFakeEnginePlugin(
  options: FakeEnginePluginOptions,
): EnginePlugin {
  let runIndex = 0;
  let lastTokens = 0;
  const pendingGoalIds: string[] = [];
  let lastThreadId: string | undefined;
  const handover = options.handover ?? "fake engine session complete";

  async function callAndLog(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{
    run: number;
    tool: string;
    args: unknown;
    isError?: boolean;
    result?: unknown;
  }> {
    const response = await options.callTool(tool, args);
    const parsed = parseToolJson(response);
    if (tool === "set_goals" && parsed && Array.isArray(parsed.goals)) {
      pendingGoalIds.length = 0;
      for (const goal of parsed.goals) {
        if (
          goal !== null &&
          typeof goal === "object" &&
          typeof (goal as { id?: unknown }).id === "string"
        ) {
          pendingGoalIds.push((goal as { id: string }).id);
        }
      }
    }
    if (
      tool === "create_thread" &&
      parsed &&
      typeof parsed.thread_id === "string"
    ) {
      lastThreadId = parsed.thread_id;
    }
    return {
      run: runIndex,
      tool,
      args,
      ...(response.isError ? { isError: true } : {}),
      ...(parsed ? { result: parsed } : {}),
    };
  }

  function resolveArgs(
    step: FakeScriptStep,
  ): Record<string, unknown> {
    const args = { ...(step.args ?? {}) };
    if (step.tool === "complete_goal") {
      const given = args.goal_id;
      if (typeof given !== "string" || !UUID_RE.test(given)) {
        const next = pendingGoalIds.shift();
        if (next) {
          args.goal_id = next;
        }
      }
    }
    if (step.tool === "read_thread") {
      const given = args.thread_id;
      if (typeof given !== "string" || !UUID_RE.test(given)) {
        if (lastThreadId) {
          args.thread_id = lastThreadId;
        }
      }
    }
    return args;
  }

  return {
    async start() {
      runIndex = 0;
    },
    async run(prompt: string) {
      runIndex += 1;
      const toolLog: Array<{
        run: number;
        tool: string;
        args: unknown;
        isError?: boolean;
        result?: unknown;
      }> = [];
      let remainingBudget: number | null = null;

      if (prompt.includes("セッション終了作業")) {
        const entry = await callAndLog("end_session", { handover });
        toolLog.push(entry);
        remainingBudget = remainingBudgetFrom(
          (entry.result as Record<string, unknown> | undefined) ?? null,
        );
        lastTokens = 1;
        return {
          transcript: `fake wind-down run ${runIndex}`,
          toolLog,
          remainingBudget,
        };
      }

      for (const step of options.script) {
        const args = resolveArgs(step);
        const entry = await callAndLog(step.tool, args);
        toolLog.push(entry);
        const fromResult = remainingBudgetFrom(
          (entry.result as Record<string, unknown> | undefined) ?? null,
        );
        if (fromResult !== null) {
          remainingBudget = fromResult;
        }
      }

      lastTokens = Math.max(1, toolLog.length);
      return {
        transcript: `fake work run ${runIndex}`,
        toolLog,
        remainingBudget,
      };
    },
    async report() {
      return { tokens: lastTokens };
    },
    async stop() {
      // Fake never spawns a child process.
    },
  };
}
