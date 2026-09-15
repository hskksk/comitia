import { GATEWAY, type Tick } from "@comitia/shared";
import { startLocalA2aServer } from "../a2a-server.js";
import { postAuthorized, postAuthorizedWithRetry } from "../board-upload.js";
import { loadConfig } from "../config.js";
import {
  startInstructLoop,
  type InstructLoopHandle,
} from "../instruct-loop.js";
import { createMcpProxyRuntime } from "../mcp-proxy.js";
import type { EnginePlugin } from "../plugins/types.js";
import { comitiaWorkspaceId, runSessionLoop } from "../session-loop.js";
import { buildRelayWsUrl, connectTunnel } from "../tunnel.js";

export interface ConnectCommandOptions {
  name: string;
  configDir?: string;
  plugin?: EnginePlugin;
  instruct?: boolean;
  systemPrompt?: boolean;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

export interface ConnectCommandHandle {
  ticks: Tick[];
  close: () => Promise<void>;
}

const SESSION_START_WAIT_MS = 1_500;

async function waitForTick(
  ticks: Tick[],
  predicate: (tick: Tick) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ticks.some(predicate)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return ticks.some(predicate);
}

export async function connectCommand(
  options: ConnectCommandOptions,
): Promise<ConnectCommandHandle> {
  const config = await loadConfig(options.configDir);
  const agent = config.agents[options.name];
  if (!agent || !config.boardUrl) {
    throw new Error(`Unknown agent: ${options.name}`);
  }

  const plugin = options.plugin;
  const ticks: Tick[] = [];
  const windDownRequestedRef = { current: false };
  let activeSessionId: string | undefined;
  let runningSessionId: string | undefined;
  let loopChain = Promise.resolve();
  let adapter: Awaited<ReturnType<typeof startLocalA2aServer>>;
  let instructLoop: InstructLoopHandle | undefined;

  const proxy = createMcpProxyRuntime({
    boardUrl: config.boardUrl,
    agentToken: agent.token,
  });

  adapter = await startLocalA2aServer({
    agentId: agent.agentId,
    relayBaseUrl: config.boardUrl,
    onTick: (tick) => {
      ticks.push(tick);
      if (options.instruct) {
        return;
      }
      if (tick.type === "session.end_warning") {
        if (runningSessionId === undefined) {
          return;
        }
        if (
          tick.sessionId !== undefined &&
          tick.sessionId !== runningSessionId
        ) {
          return;
        }
        windDownRequestedRef.current = true;
        return;
      }
      if (tick.type !== "session.start") {
        return;
      }
      if (!plugin || !tick.sessionId || tick.sessionId === activeSessionId) {
        return;
      }
      activeSessionId = tick.sessionId;
      const sessionId = tick.sessionId;
      loopChain = loopChain
        .then(() => {
          runningSessionId = sessionId;
          windDownRequestedRef.current = false;
          return runSessionLoop({
            plugin,
            callTool: (name, args) => proxy.callTool(name, args),
            onChatLog: async (chunk) => {
              await postAuthorizedWithRetry(
                config.boardUrl,
                agent.token,
                `/v1/sessions/${sessionId}/chat-log`,
                { chunk },
              );
            },
            onChatLogError: (message) => {
              console.error(`[chat-log] ${message}`);
            },
            onTraceEntries: async (entries) => {
              await postAuthorizedWithRetry(
                config.boardUrl,
                agent.token,
                `/v1/sessions/${sessionId}/trace`,
                { entries },
              );
            },
            onTraceError: (message) => {
              console.error(`[trace] ${message}`);
            },
            maxRuns: GATEWAY.maxRuns,
            idleRunLimit: GATEWAY.idleRunLimit,
            windDownRequestedRef,
            sessionId,
            boardUrl: config.boardUrl,
            agentToken: agent.token,
            workspaceId: comitiaWorkspaceId(options.name),
          }).finally(() => {
            windDownRequestedRef.current = false;
            if (runningSessionId === sessionId) {
              runningSessionId = undefined;
            }
            if (activeSessionId === sessionId) {
              activeSessionId = undefined;
            }
            adapter.clearActiveSession(sessionId);
          });
        })
        .catch((error: unknown) => {
          console.error(error);
        });
    },
  });
  let tunnel;
  try {
    tunnel = await connectTunnel({
      relayWsUrl: buildRelayWsUrl(config.boardUrl, agent.agentId, agent.token),
      localBaseUrl: adapter.localBaseUrl,
    });
  } catch (error) {
    await adapter.close();
    await options.plugin?.dispose();
    throw error;
  }

  const teardown = async () => {
    instructLoop?.stop();
    await instructLoop?.done.catch(() => undefined);
    tunnel.disconnect();
    await loopChain.catch(() => undefined);
    await adapter.close();
    await options.plugin?.dispose();
  };

  try {
    if (options.instruct) {
      if (plugin) {
        instructLoop = await startInstructLoop({
          plugin,
          boardUrl: config.boardUrl,
          agentToken: agent.token,
          workspaceId: comitiaWorkspaceId(options.name),
          systemPrompt: options.systemPrompt === true,
          stdin: options.stdin ?? process.stdin,
          stdout: options.stdout ?? process.stdout,
        });
      }
    } else {
      const gotStart = await waitForTick(
        ticks,
        (tick) => tick.type === "session.start",
        SESSION_START_WAIT_MS,
      );
      if (!gotStart) {
        const requested = await postAuthorized(
          config.boardUrl,
          agent.token,
          "/v1/me/request-session",
          {},
        );
        if (!requested.ok) {
          throw new Error(`request-session failed: ${requested.status}`);
        }
      }
    }
  } catch (error) {
    await teardown();
    throw error;
  }

  return {
    ticks,
    close: teardown,
  };
}
