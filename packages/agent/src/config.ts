import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LocalAgentConfig {
  agentId: string;
  token: string;
  engine: string;
  /** Engine `--model` override. Omitted = engine default. */
  model?: string;
}

export interface ComitiaConfig {
  boardUrl: string;
  ownerToken?: string;
  ownerId?: string;
  projectId?: string;
  agents: Record<string, LocalAgentConfig>;
}

/** Empty or whitespace means "use the engine default". */
export function normalizeEngineModel(
  model: string | undefined,
): string | undefined {
  const trimmed = model?.trim();
  return trimmed ? trimmed : undefined;
}

function defaultConfigDir(): string {
  return join(homedir(), ".comitia");
}

export async function loadConfig(
  dir = defaultConfigDir(),
): Promise<ComitiaConfig> {
  try {
    const contents = await readFile(join(dir, "config.json"), "utf8");
    return JSON.parse(contents) as ComitiaConfig;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { boardUrl: "", agents: {} };
    }
    throw error;
  }
}

export async function saveConfig(
  dir = defaultConfigDir(),
  config: ComitiaConfig,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
}
