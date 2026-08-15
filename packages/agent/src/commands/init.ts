import { saveConfig } from "../config.js";

export interface InitCommandOptions {
  boardUrl: string;
  name: string;
  project: string;
  configDir?: string;
}

export async function initCommand(options: InitCommandOptions): Promise<void> {
  const response = await fetch(new URL("/v1/init", options.boardUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerDisplayName: options.name,
      projectName: options.project,
    }),
  });
  if (!response.ok) {
    throw new Error(`Board init failed: ${response.status} ${await response.text()}`);
  }

  const result = (await response.json()) as {
    ownerId: string;
    projectId: string;
    ownerToken: string;
  };
  await saveConfig(options.configDir, {
    boardUrl: options.boardUrl,
    ownerId: result.ownerId,
    projectId: result.projectId,
    ownerToken: result.ownerToken,
    agents: {},
  });
}
