import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
 * Host credential-store pin. Empty means "use Claude's default store"
 * (`Claude Code-credentials` on macOS, `~/.claude/.credentials.json` on Linux).
 *
 * Do not export an empty CLAUDE_SECURESTORAGE_CONFIG_DIR to the child: the
 * bun-compiled `claude` binary treats empty as unset, then hashes
 * CLAUDE_CONFIG_DIR into a different Keychain item and reports
 * `apiKeySource: none`. Leave both vars unset for the default login.
 * A non-empty host CLAUDE_CONFIG_DIR is passed through as the secure-storage
 * pin only — never as the child's CLAUDE_CONFIG_DIR. The child keeps the
 * host HOME so Keychain / ~/.claude credentials resolve the same way as an
 * interactive `claude` session.
 */
export function resolveClaudeSecureStoragePin(
  env: NodeJS.ProcessEnv = process.env,
  hostHome: string = resolveHostHome(env),
): string {
  if (Object.prototype.hasOwnProperty.call(env, "CLAUDE_SECURESTORAGE_CONFIG_DIR")) {
    return env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? "";
  }
  if (typeof env.CLAUDE_CONFIG_DIR === "string" && env.CLAUDE_CONFIG_DIR.length > 0) {
    if (env.CLAUDE_CONFIG_DIR === join(hostHome, ".claude")) {
      // Hashing the default path selects a *different* Keychain item than
      // the unsuffixed `Claude Code-credentials` login.
      return "";
    }
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

/**
 * Point the child at the host login without namespacing macOS Keychain.
 * The child keeps the host HOME; do not set CLAUDE_CONFIG_DIR.
 */
export function applyClaudeCredentialEnv(
  env: NodeJS.ProcessEnv,
  hostEnv: NodeJS.ProcessEnv = env,
  hostHome: string = resolveHostHome(hostEnv),
): NodeJS.ProcessEnv {
  const pin = resolveClaudeSecureStoragePin(hostEnv, hostHome);
  delete env.CLAUDE_CONFIG_DIR;
  if (pin.length > 0) {
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR = pin;
  } else {
    delete env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  }
  return env;
}

export function claudeKeychainServiceName(pin: string): string {
  if (pin.length === 0) {
    return "Claude Code-credentials";
  }
  const suffix = createHash("sha256")
    .update(pin.normalize("NFC"))
    .digest("hex")
    .slice(0, 8);
  return `Claude Code-credentials-${suffix}`;
}

export function claudeKeychainAccount(
  env: NodeJS.ProcessEnv = process.env,
): string {
  let user = env.USER ?? "";
  if (!user) {
    try {
      user = userInfo().username;
    } catch {
      user = "";
    }
  }
  return /^[a-zA-Z0-9._-]+$/.test(user) ? user : "claude-code-user";
}

export type KeychainPasswordReader = (
  service: string,
  account: string | undefined,
) => string | null;

function defaultKeychainReader(
  service: string,
  account: string | undefined,
): string | null {
  if (process.platform !== "darwin") {
    return null;
  }
  const args = ["find-generic-password", "-s", service];
  if (account) {
    args.push("-a", account);
  }
  args.push("-w");
  const result = spawnSync("security", args, {
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return null;
  }
  const stdout = result.stdout.trim();
  return stdout.length > 0 ? stdout : null;
}

export function blobHasClaudeOauth(blob: string): boolean {
  try {
    const parsed = JSON.parse(blob) as { claudeAiOauth?: unknown };
    return parsed !== null && typeof parsed === "object" && parsed.claudeAiOauth != null;
  } catch {
    return false;
  }
}

export function readMacosClaudeKeychain(
  env: NodeJS.ProcessEnv = process.env,
  readPassword: KeychainPasswordReader = defaultKeychainReader,
  hostHome: string = resolveHostHome(env),
): string | null {
  const service = claudeKeychainServiceName(
    resolveClaudeSecureStoragePin(env, hostHome),
  );
  const account = claudeKeychainAccount(env);
  const withAccount = readPassword(service, account);
  if (withAccount) {
    return withAccount;
  }
  return readPassword(service, undefined);
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
 * Copy host Claude login files into an isolated HOME. Unused by agent
 * connect (that path keeps the real HOME). Kept for tests and any caller
 * that still remaps HOME. Host hooks / plugins / session history are not copied.
 *
 * Do not wire this back into connect. Copying Claude.ai OAuth files is a
 * gray zone under Anthropic's "do not collect, store, or intermediate
 * credentials" rule. See docs/design/11-engine-vendor-terms.md §5.2.
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
  | { kind: "keychain" }
  | { kind: "host-login" };

export async function detectClaudeAuthSource(
  env: NodeJS.ProcessEnv = process.env,
  hostHome: string = resolveHostHome(env),
  options: {
    readKeychain?: (env: NodeJS.ProcessEnv) => string | null;
  } = {},
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
    // Fall through to Keychain on macOS.
  }
  const blob =
    options.readKeychain?.(env) ??
    (process.platform === "darwin" ? readMacosClaudeKeychain(env) : null);
  if (blob && blobHasClaudeOauth(blob)) {
    return { kind: "keychain" };
  }
  return { kind: "host-login" };
}
