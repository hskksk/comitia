import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FAKE_OPENCODE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../test/fake-opencode.mjs",
);

export async function installFakeCommand(
  binDir: string,
  command: string,
): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const dest = join(binDir, command);
  await symlink(FAKE_OPENCODE, dest);
  await chmod(dest, 0o755);
  await chmod(FAKE_OPENCODE, 0o755);
  return dest;
}

export async function installFakeOpencode(binDir: string): Promise<string> {
  return installFakeCommand(binDir, "opencode");
}

export async function writeHostOpencodeAuth(
  hostHome: string,
  auth: Record<string, unknown> = { ok: true },
): Promise<string> {
  const shareDir = join(hostHome, ".local", "share", "opencode");
  await mkdir(shareDir, { recursive: true });
  const authPath = join(shareDir, "auth.json");
  await writeFile(authPath, `${JSON.stringify(auth)}\n`, "utf8");
  return shareDir;
}

export function withFakePath(
  binDir: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pathKey = env.PATH !== undefined ? "PATH" : "Path";
  return {
    ...env,
    [pathKey]: `${binDir}${env[pathKey] ? `:${env[pathKey]}` : ""}`,
  };
}
