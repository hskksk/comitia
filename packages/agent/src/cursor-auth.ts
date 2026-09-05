import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { resolveHostHome } from "./claude-auth.js";

const CURSOR_KEYCHAIN_ACCOUNT = "cursor-user";
const CURSOR_KEYCHAIN_SERVICES = [
  "cursor-access-token",
  "cursor-api-key",
  "cursor-refresh-token",
] as const;

export function hostCursorAuthJsonPath(hostHome: string): string {
  return join(hostHome, ".cursor", "auth.json");
}

/**
 * macOS Keychain items used by `agent login`. Service names are fixed
 * (not hashed by HOME), so a remapped runtime HOME still resolves them.
 * Do not pass `-w`: we only need existence, never the secret.
 */
export function cursorKeychainHasLogin(
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "darwin") {
    return false;
  }
  for (const service of CURSOR_KEYCHAIN_SERVICES) {
    const result = spawnSync(
      "security",
      ["find-generic-password", "-s", service, "-a", CURSOR_KEYCHAIN_ACCOUNT],
      {
        encoding: "utf8",
        timeout: 3_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.status === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Point the isolated runtime HOME at the host `agent login` file without
 * copying credentials. MCP stays in the runtime `.cursor/mcp.json`.
 * Do not copy auth.json (design 11 §5.2).
 */
export async function attachHostCursorAuth(
  runtimeHome: string,
  hostHome: string,
): Promise<void> {
  const hostAuth = hostCursorAuthJsonPath(hostHome);
  if (!existsSync(hostAuth)) {
    return;
  }
  const destDir = join(runtimeHome, ".cursor");
  await mkdir(destDir, { recursive: true });
  const destAuth = join(destDir, "auth.json");
  try {
    await lstat(destAuth);
    return;
  } catch {
    // Destination is missing; attach via symlink.
  }
  await symlink(hostAuth, destAuth);
}

export type CursorAuthSource =
  | { kind: "api-key" }
  | { kind: "auth-token" }
  | { kind: "auth-file" }
  | { kind: "keychain" }
  | { kind: "none" };

export async function detectCursorAuthSource(
  env: NodeJS.ProcessEnv = process.env,
  hostHome: string = resolveHostHome(env),
  options: {
    keychainHasLogin?: () => boolean;
  } = {},
): Promise<CursorAuthSource> {
  if (typeof env.CURSOR_API_KEY === "string" && env.CURSOR_API_KEY.length > 0) {
    return { kind: "api-key" };
  }
  if (
    typeof env.CURSOR_AUTH_TOKEN === "string" &&
    env.CURSOR_AUTH_TOKEN.length > 0
  ) {
    return { kind: "auth-token" };
  }
  if (existsSync(hostCursorAuthJsonPath(hostHome))) {
    return { kind: "auth-file" };
  }
  const hasKeychain = options.keychainHasLogin ?? cursorKeychainHasLogin;
  if (hasKeychain()) {
    return { kind: "keychain" };
  }
  return { kind: "none" };
}
