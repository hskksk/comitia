import {
  derivePreviewBootstrapToken,
  isRailwayPrPreviewEnvironment,
} from "./railway.js";

const BOOTSTRAP_TOKEN_RE = /^comt_[0-9a-f]{64}$/;

export function isBootstrapTokenFormat(token: string): boolean {
  return BOOTSTRAP_TOKEN_RE.test(token);
}

export function readPreviewAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const explicitToken = env.COMITIA_BOOTSTRAP_TOKEN?.trim();
  const autoPreview = isRailwayPrPreviewEnvironment(env);
  const databaseUrl = env.DATABASE_URL?.trim();
  const environmentId = env.RAILWAY_ENVIRONMENT_ID?.trim();

  let bootstrapToken: string | undefined;
  if (explicitToken && isBootstrapTokenFormat(explicitToken)) {
    bootstrapToken = explicitToken;
  } else if (autoPreview && databaseUrl && environmentId) {
    bootstrapToken = derivePreviewBootstrapToken({
      environmentId,
      databaseUrl,
    });
  }

  const branch = env.RAILWAY_GIT_BRANCH?.trim();
  const projectName =
    env.COMITIA_BOOTSTRAP_PROJECT_NAME?.trim() ||
    (branch ? sanitizeProjectName(branch) : "preview");

  return {
    enabled: Boolean(bootstrapToken),
    autoPreview,
    bootstrapToken,
    ownerDisplayName:
      env.COMITIA_BOOTSTRAP_OWNER_NAME?.trim() || "Preview",
    projectName,
  };
}

function sanitizeProjectName(branch: string): string {
  const trimmed = branch
    .replace(/\//g, ".")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return trimmed.slice(0, 64) || "preview";
}
