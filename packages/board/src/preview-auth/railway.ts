import { createHash } from "node:crypto";

/**
 * Detect Railway PR preview environments without relying on a persistent
 * staging base or per-PR variable setup.
 */
export function isRailwayPrPreviewEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!env.RAILWAY_ENVIRONMENT_ID?.trim()) {
    return false;
  }

  const envName = env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  if (envName === "production") {
    return false;
  }

  const autoPreview = env.COMITIA_AUTO_PREVIEW?.trim();
  if (autoPreview === "0") {
    return false;
  }
  if (autoPreview === "1") {
    return true;
  }

  const branch = env.RAILWAY_GIT_BRANCH?.trim();
  if (branch && branch !== "main") {
    return true;
  }

  if (envName && (/^pr-/i.test(envName) || /-pr-/i.test(envName))) {
    return true;
  }

  return false;
}

export function derivePreviewBootstrapToken(input: {
  environmentId: string;
  databaseUrl: string;
}): string {
  const digest = createHash("sha256")
    .update(`comitia-preview-v1\0${input.environmentId}\0${input.databaseUrl}`)
    .digest("hex");
  return `comt_${digest}`;
}
