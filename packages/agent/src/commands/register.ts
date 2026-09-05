import {
  loadConfig,
  normalizeEngineModel,
  saveConfig,
  type LocalAgentConfig,
} from "../config.js";
import { assertSupportedEngine } from "../engines.js";
import { resolvePersonalitySpec } from "../personality-spec.js";

export interface RegisterCommandOptions {
  name: string;
  engine: string;
  role?: string;
  project?: string;
  personality?: string;
  model?: string;
  configDir?: string;
}

export async function registerCommand(
  options: RegisterCommandOptions,
): Promise<void> {
  assertSupportedEngine(options.engine);

  const config = await loadConfig(options.configDir);
  if (!config.boardUrl || !config.ownerToken) {
    throw new Error("Run `comitia init` before registering an agent");
  }

  const personality =
    options.personality === undefined
      ? undefined
      : resolvePersonalitySpec(options.personality);

  const response = await fetch(new URL("/v1/agents", config.boardUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.ownerToken}`,
    },
    body: JSON.stringify({
      displayName: options.name,
      engine: options.engine,
      ...(options.role ? { role: options.role } : {}),
      ...(personality !== undefined ? { personality } : {}),
      ...(options.project || config.projectId
        ? { projectId: options.project ?? config.projectId }
        : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Agent registration failed: ${response.status} ${await response.text()}`,
    );
  }

  const result = (await response.json()) as {
    agentId: string;
    projectId: string;
    agentToken: string;
  };
  const local: LocalAgentConfig = {
    agentId: result.agentId,
    token: result.agentToken,
    engine: options.engine,
  };
  const model = normalizeEngineModel(options.model);
  if (model) {
    local.model = model;
  }
  await saveConfig(options.configDir, {
    ...config,
    projectId: result.projectId,
    agents: {
      ...config.agents,
      [options.name]: local,
    },
  });
}
