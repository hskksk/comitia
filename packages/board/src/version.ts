import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function readVersionFromPackageJson(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const APP_VERSION =
  process.env.COMITIA_VERSION?.trim() || readVersionFromPackageJson();

export const APP_COMMIT =
  process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
  process.env.GIT_COMMIT?.trim() ||
  undefined;

export function healthPayload(): { ok: true; version: string; commit?: string } {
  const payload: { ok: true; version: string; commit?: string } = {
    ok: true,
    version: APP_VERSION,
  };
  if (APP_COMMIT) {
    payload.commit = APP_COMMIT.slice(0, 7);
  }
  return payload;
}
