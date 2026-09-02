import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { formatTraceHuman, TRACE_VERSION, type TraceEvent } from "@comitia/shared";
import { openBay, type Bay, type BayEvent, type EngineId } from "enginebay";
import { joinSystemPrompt } from "../environment-prompt.js";
import { extractRemainingBudget } from "../trace-format.js";
import { TOOLSET_OVERVIEW } from "./tool-catalog.js";
import { resolveMcpStdioEntrypoint } from "./mcp-stdio.js";
import type {
  EngineGithubAuth,
  EnginePlugin,
  EngineRunContext,
} from "./types.js";

const RM_OPTS = {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 100,
} as const;

export function githubAuthToExtraEnv(
  auth: EngineGithubAuth | null | undefined,
): Record<string, string> {
  if (!auth?.token) {
    return {};
  }
  return { GH_TOKEN: auth.token, GITHUB_TOKEN: auth.token };
}

export function bayEventToTracePartial(
  event: BayEvent,
  run: number,
): Omit<TraceEvent, "v" | "seq" | "at"> | null {
  switch (event.kind) {
    case "text":
      return { kind: "text", text: event.text, run };
    case "thinking":
      return { kind: "thinking", text: event.text, run };
    case "tool_call":
      return {
        kind: "tool_call",
        tool: event.tool,
        args: event.args ?? {},
        run,
      };
    case "tool_result": {
      const remainingBudget = extractRemainingBudget(event.result);
      return {
        kind: "tool_result",
        tool: event.tool,
        result: event.result,
        isError: event.ok ? undefined : true,
        remainingBudget: remainingBudget ?? undefined,
        run,
      };
    }
    case "diagnostic":
      return { kind: "adapter_note", message: event.text, run };
    default:
      return null;
  }
}

export function createBayEnginePlugin(options: {
  engine: EngineId;
  hostEnv?: NodeJS.ProcessEnv;
  hostHome?: string;
  stdout?: NodeJS.WritableStream;
  model?: string;
  notStartedMessage: string;
  exitError: (code: number) => string;
}): EnginePlugin {
  const consoleOut = options.stdout;
  let workDir: string | undefined;
  let workDirPersistent = false;
  let bay: Bay | undefined;
  let runIndex = 0;
  let lastTokens = 0;
  let committerName = "enginebay";

  async function applyGithubAuth(auth: EngineGithubAuth | null) {
    if (auth?.committerName) {
      committerName = auth.committerName;
    }
    if (bay) {
      await bay.updateExtraEnv(githubAuthToExtraEnv(auth), {
        committerName,
      });
    }
  }

  return {
    async start(session) {
      if (bay) {
        await bay.close();
        bay = undefined;
      }
      workDir = session.workDir;
      workDirPersistent = session.workDirPersistent;
      if (session.github?.committerName) {
        committerName = session.github.committerName;
      }
      const mcpEntrypoint = resolveMcpStdioEntrypoint();
      if (!existsSync(mcpEntrypoint)) {
        throw new Error(
          `MCP stdio entry not found at ${mcpEntrypoint}. Build @comitia/agent first.`,
        );
      }
      const environmentPrompt = session.environmentPrompt ?? "";
      bay = await openBay({
        engine: options.engine,
        workDir: session.workDir,
        hostEnv: options.hostEnv,
        hostHome: options.hostHome,
        model: options.model,
        instructions: environmentPrompt
          ? joinSystemPrompt(environmentPrompt, TOOLSET_OVERVIEW)
          : TOOLSET_OVERVIEW,
        mcp: {
          command: session.mcp.command,
          args: [...session.mcp.args, mcpEntrypoint],
          env: session.mcp.env,
          name: "comitia-board",
        },
        extraEnv: githubAuthToExtraEnv(session.github),
        git: { committerName },
      });
      runIndex = 0;
      lastTokens = 0;
    },

    async updateGithubAuth(auth) {
      await applyGithubAuth(auth);
    },

    async run(prompt, ctx?: EngineRunContext) {
      if (!bay || !workDir) {
        throw new Error(options.notStartedMessage);
      }
      runIndex += 1;
      const toolByCall = new Map<string, { tool: string; args: unknown }>();
      const toolLog: Array<{
        run: number;
        tool: string;
        args: unknown;
        isError?: boolean;
        result?: unknown;
      }> = [];
      const events: TraceEvent[] = [];
      let remainingBudget: number | null = null;
      let exitCode = 0;
      const traceLive = ctx?.traceLive === true && ctx.trace !== undefined;

      for await (const event of bay.run(prompt)) {
        if (event.kind === "tokens") {
          lastTokens =
            event.total ?? (event.input ?? 0) + (event.output ?? 0);
          continue;
        }
        if (event.kind === "exit") {
          exitCode = event.code;
          continue;
        }
        if (event.kind === "tool_call") {
          toolByCall.set(event.callId, {
            tool: event.tool,
            args: event.args,
          });
        }
        if (event.kind === "tool_result") {
          const call = toolByCall.get(event.callId);
          const fromResult = extractRemainingBudget(event.result);
          if (fromResult !== null) {
            remainingBudget = fromResult;
          }
          toolLog.push({
            run: runIndex,
            tool: event.tool,
            args: call?.args,
            ...(event.ok ? {} : { isError: true }),
            result: event.result,
          });
        }
        const partial = bayEventToTracePartial(event, runIndex);
        if (!partial) {
          continue;
        }
        if (ctx?.trace && traceLive) {
          ctx.trace.emit(partial);
        } else if (ctx?.trace) {
          events.push({
            v: TRACE_VERSION,
            seq: events.length,
            at: new Date().toISOString(),
            ...partial,
          } as TraceEvent);
        }
        if (consoleOut) {
          const human = formatTraceHuman({
            v: 1,
            seq: 0,
            at: "",
            ...partial,
          } as TraceEvent);
          if (human) {
            consoleOut.write(`${human}\n`);
          }
        }
      }

      if (exitCode !== 0) {
        throw new Error(options.exitError(exitCode));
      }
      return {
        transcript: "",
        toolLog,
        remainingBudget,
        traceEvents: ctx?.trace && !traceLive ? events : undefined,
      };
    },

    async report() {
      return { tokens: lastTokens };
    },

    async stop() {
      await bay?.abort();
      if (workDir && !workDirPersistent) {
        await rm(workDir, RM_OPTS);
      }
      workDir = undefined;
      workDirPersistent = false;
    },

    async dispose() {
      await bay?.close();
      bay = undefined;
      if (workDir && !workDirPersistent) {
        await rm(workDir, RM_OPTS);
      }
      workDir = undefined;
      workDirPersistent = false;
    },
  };
}
