import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

export function resolveHostHome(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const fromOs = userInfo().homedir;
    if (fromOs) {
      return fromOs;
    }
  } catch {
    // userInfo() throws when the process has no passwd entry.
  }
  if (typeof env.HOME === "string" && env.HOME.length > 0) {
    return env.HOME;
  }
  return homedir();
}

/**
 * Pin for CLAUDE_SECURESTORAGE_CONFIG_DIR.
 *
 * Isolated HOME remaps Claude's config dir, which would otherwise hash to a
 * different macOS Keychain entry / Linux credentials file. An empty string
 * pins the default store even when CLAUDE_CONFIG_DIR is set. A host
 * CLAUDE_CONFIG_DIR (or an already-set secure-storage dir) is passed through
 * verbatim — Claude hashes the string as-is, with no path canonicalization.
 */
export function resolveClaudeSecureStoragePin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (Object.prototype.hasOwnProperty.call(env, "CLAUDE_SECURESTORAGE_CONFIG_DIR")) {
    return env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? "";
  }
  if (typeof env.CLAUDE_CONFIG_DIR === "string" && env.CLAUDE_CONFIG_DIR.length > 0) {
    return env.CLAUDE_CONFIG_DIR;
  }
  return "";
}

export function resolveHostClaudeCredentialsDir(
  env: NodeJS.ProcessEnv = process.env,
  hostHome: string = resolveHostHome(env),
): string {
  if (
    typeof env.CLAUDE_SECURESTORAGE_CONFIG_DIR === "string" &&
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR.length > 0
  ) {
    return env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  }
  if (
    !Object.prototype.hasOwnProperty.call(env, "CLAUDE_SECURESTORAGE_CONFIG_DIR") &&
    typeof env.CLAUDE_CONFIG_DIR === "string" &&
    env.CLAUDE_CONFIG_DIR.length > 0
  ) {
    return env.CLAUDE_CONFIG_DIR;
  }
  return join(hostHome, ".claude");
}

async function copyPrivateFile(from: string, to: string): Promise<boolean> {
  try {
    await copyFile(from, to);
    await chmod(to, 0o600);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES") {
      return false;
    }
    throw error;
  }
}

function stripHostMcpServers(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      delete parsed.mcpServers;
    }
    return `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    return raw;
  }
}

/**
 * Copy host Claude login files into the isolated HOME so Linux
 * `.credentials.json` works even if the secure-storage pin is ignored.
 * macOS Keychain login is inherited via CLAUDE_SECURESTORAGE_CONFIG_DIR.
 * Host hooks / plugins / session history are not copied.
 */
export async function seedIsolatedClaudeAuth(
  isolatedHome: string,
  options: {
    env?: NodeJS.ProcessEnv;
    hostHome?: string;
  } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const hostHome = options.hostHome ?? resolveHostHome(env);
  const credentialsDir = resolveHostClaudeCredentialsDir(env, hostHome);
  const isolatedConfigDir = join(isolatedHome, ".claude");
  await mkdir(isolatedConfigDir, { recursive: true });

  await copyPrivateFile(
    join(credentialsDir, ".credentials.json"),
    join(isolatedConfigDir, ".credentials.json"),
  );

  const claudeJsonSources = [
    join(hostHome, ".claude.json"),
    join(credentialsDir, ".claude.json"),
  ];
  const isolatedClaudeJson = join(isolatedHome, ".claude.json");
  for (const source of claudeJsonSources) {
    try {
      const raw = await readFile(source, "utf8");
      await writeFile(isolatedClaudeJson, stripHostMcpServers(raw), {
        mode: 0o600,
      });
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES") {
        continue;
      }
      throw error;
    }
  }
}

export type ClaudeAuthSource =
  | { kind: "api-key" }
  | { kind: "oauth-token" }
  | { kind: "credentials-file" }
  | { kind: "host-login" };

export async function detectClaudeAuthSource(
  env: NodeJS.ProcessEnv = process.env,
  hostHome: string = resolveHostHome(env),
): Promise<ClaudeAuthSource> {
  if (typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0) {
    return { kind: "api-key" };
  }
  if (
    typeof env.CLAUDE_CODE_OAUTH_TOKEN === "string" &&
    env.CLAUDE_CODE_OAUTH_TOKEN.length > 0
  ) {
    return { kind: "oauth-token" };
  }
  try {
    await access(
      join(resolveHostClaudeCredentialsDir(env, hostHome), ".credentials.json"),
      constants.R_OK,
    );
    return { kind: "credentials-file" };
  } catch {
    return { kind: "host-login" };
  }
}
