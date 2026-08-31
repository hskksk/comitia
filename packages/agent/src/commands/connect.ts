import { GATEWAY, type Tick } from "@comitia/shared";
import { startLocalA2aServer } from "../a2a-server.js";
import { loadConfig } from "../config.js";
import { createMcpProxyRuntime } from "../mcp-proxy.js";
import type { EnginePlugin } from "../plugins/types.js";
import { runSessionLoop } from "../session-loop.js";
import { buildRelayWsUrl, connectTunnel } from "../tunnel.js";

export interface ConnectCommandOptions {
  name: string;
  configDir?: string;
  plugin?: EnginePlugin;
}

export interface ConnectCommandHandle {
  ticks: Tick[];
  close: () => Promise<void>;
}

const SESSION_START_WAIT_MS = 1_500;

async function postAuthorized(
  boardUrl: string,
  token: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${boardUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

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

  const proxy = createMcpProxyRuntime({
    boardUrl: config.boardUrl,
    agentToken: agent.token,
  });

  adapter = await startLocalA2aServer({
    agentId: agent.agentId,
    relayBaseUrl: config.boardUrl,
    onTick: (tick) => {
      ticks.push(tick);
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
              const response = await postAuthorized(
                config.boardUrl,
                agent.token,
                `/v1/sessions/${sessionId}/chat-log`,
                { chunk },
              );
              if (!response.ok) {
                const body = await response.text().catch(() => "");
                console.error(
                  `[chat-log] POST failed: ${response.status}${body ? ` ${body}` : ""}`,
                );
              }
            },
            onChatLogError: (message) => {
              console.error(`[chat-log] ${message}`);
            },
            onTraceEntries: async (entries) => {
              const response = await postAuthorized(
                config.boardUrl,
                agent.token,
                `/v1/sessions/${sessionId}/trace`,
                { entries },
              );
              if (!response.ok) {
                const body = await response.text().catch(() => "");
                console.error(
                  `[trace] POST failed: ${response.status}${body ? ` ${body}` : ""}`,
                );
              }
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

  try {
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
  } catch (error) {
    tunnel.disconnect();
    await adapter.close();
    await options.plugin?.dispose();
    throw error;
  }

  return {
    ticks,
    close: async () => {
      tunnel.disconnect();
      await loopChain.catch(() => undefined);
      await adapter.close();
      await options.plugin?.dispose();
    },
  };
}
