import type { Tick } from "@comitia/shared";
import { startLocalA2aServer } from "../a2a-server.js";
import { loadConfig } from "../config.js";
import { buildRelayWsUrl, connectTunnel } from "../tunnel.js";

export interface ConnectCommandOptions {
  name: string;
  configDir?: string;
  plugin?: unknown;
}

export interface ConnectCommandHandle {
  ticks: Tick[];
  close: () => Promise<void>;
}

export async function connectCommand(
  options: ConnectCommandOptions,
): Promise<ConnectCommandHandle> {
  const config = await loadConfig(options.configDir);
  const agent = config.agents[options.name];
  if (!agent || !config.boardUrl) {
    throw new Error(`Unknown agent: ${options.name}`);
  }

  const ticks: Tick[] = [];
  const adapter = await startLocalA2aServer({
    agentId: agent.agentId,
    relayBaseUrl: config.boardUrl,
    onTick: (tick) => {
      ticks.push(tick);
    },
  });
  const tunnel = await connectTunnel({
    relayWsUrl: buildRelayWsUrl(config.boardUrl, agent.agentId, agent.token),
    localBaseUrl: adapter.localBaseUrl,
  });

  return {
    ticks,
    close: async () => {
      tunnel.disconnect();
      await adapter.close();
    },
  };
}
