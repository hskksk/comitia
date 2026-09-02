import { createBayEnginePlugin } from "./bay-engine.js";
import type { EnginePlugin } from "./types.js";

export {
  bayEventToTracePartial,
  githubAuthToExtraEnv,
} from "./bay-engine.js";

export function createOpencodePlugin(
  options: {
    hostEnv?: NodeJS.ProcessEnv;
    hostHome?: string;
    stdout?: NodeJS.WritableStream;
    model?: string;
  } = {},
): EnginePlugin {
  return createBayEnginePlugin({
    engine: "opencode",
    hostEnv: options.hostEnv,
    hostHome: options.hostHome,
    stdout: options.stdout,
    model: options.model,
    notStartedMessage: "OpenCode plugin has not been started",
    exitError: (code) => `opencode exited with code ${code}`,
  });
}
