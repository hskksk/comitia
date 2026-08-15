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
  let loopChain = Promise.resolve();

  const proxy = createMcpProxyRuntime({
    boardUrl: config.boardUrl,
    agentToken: agent.token,
  });

  const adapter = await startLocalA2aServer({
    agentId: agent.agentId,
    relayBaseUrl: config.boardUrl,
    onTick: (tick) => {
      ticks.push(tick);
      if (tick.type === "session.end_warning") {
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
        .then(() =>
          runSessionLoop({
            plugin,
            callTool: (name, args) => proxy.callTool(name, args),
            onChatLog: async (chunk) => {
              await postAuthorized(
                config.boardUrl,
                agent.token,
                `/v1/sessions/${sessionId}/chat-log`,
                { chunk },
              );
            },
            maxRuns: GATEWAY.maxRuns,
            idleRunLimit: GATEWAY.idleRunLimit,
            windDownRequestedRef,
            sessionId,
            boardUrl: config.boardUrl,
            agentToken: agent.token,
          }).finally(() => {
            if (activeSessionId === sessionId) {
              activeSessionId = undefined;
            }
          }),
        )
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
    throw error;
  }

  try {
    const requested = await postAuthorized(
      config.boardUrl,
      agent.token,
      "/v1/me/request-session",
      {},
    );
    if (!requested.ok) {
      throw new Error(`request-session failed: ${requested.status}`);
    }
  } catch (error) {
    tunnel.disconnect();
    await adapter.close();
    throw error;
  }

  return {
    ticks,
    close: async () => {
      tunnel.disconnect();
      await loopChain.catch(() => undefined);
      await adapter.close();
    },
  };
}
