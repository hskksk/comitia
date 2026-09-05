import { createBayEnginePlugin } from "./bay-engine.js";
import type { EnginePlugin } from "./types.js";

export function createCursorAgentPlugin(
  options: {
    hostEnv?: NodeJS.ProcessEnv;
    hostHome?: string;
    stdout?: NodeJS.WritableStream;
    model?: string;
  } = {},
): EnginePlugin {
  return createBayEnginePlugin({
    engine: "cursor-agent",
    hostEnv: options.hostEnv,
    hostHome: options.hostHome,
    stdout: options.stdout,
    model: options.model,
    notStartedMessage: "Cursor Agent plugin has not been started",
    exitError: (code) => `cursor-agent exited with code ${code}`,
  });
}
