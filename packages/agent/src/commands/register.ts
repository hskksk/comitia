import { loadConfig, saveConfig } from "../config.js";
import { assertSupportedEngine } from "../engines.js";

export interface RegisterCommandOptions {
  name: string;
  engine: string;
  role?: string;
  project?: string;
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
  await saveConfig(options.configDir, {
    ...config,
    projectId: result.projectId,
    agents: {
      ...config.agents,
      [options.name]: {
        agentId: result.agentId,
        token: result.agentToken,
        engine: options.engine,
      },
    },
  });
}
