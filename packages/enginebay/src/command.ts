import { spawnSync } from "node:child_process";

export function commandExists(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const result = spawnSync(command, ["--version"], {
    env,
    stdio: "ignore",
    timeout: 15_000,
  });
  return !result.error && result.status === 0;
}

export function readCommandVersion(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const result = spawnSync(command, ["--version"], {
    env,
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return text.length > 0 ? text.split("\n")[0] : undefined;
}
