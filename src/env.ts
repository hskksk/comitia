const GITHUB_TOKEN_KEYS = ["GH_TOKEN", "GITHUB_TOKEN"] as const;

export function resolveHostHome(
  hostEnv: NodeJS.ProcessEnv = process.env,
  hostHome?: string,
): string {
  if (hostHome && hostHome.length > 0) {
    return hostHome;
  }
  const fromEnv = hostEnv.HOME;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }
  throw new Error("enginebay: host HOME is not set");
}

/**
 * Copy the host env, drop host GitHub tokens, then apply extraEnv last.
 */
export function buildChildEnv(options: {
  hostEnv?: NodeJS.ProcessEnv;
  extraEnv?: Record<string, string>;
  overrides: Record<string, string | undefined>;
}): NodeJS.ProcessEnv {
  const hostEnv = options.hostEnv ?? process.env;
  const env: NodeJS.ProcessEnv = { ...hostEnv };
  for (const key of GITHUB_TOKEN_KEYS) {
    delete env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  for (const [key, value] of Object.entries(options.overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  if (options.extraEnv) {
    Object.assign(env, options.extraEnv);
  }
  return env;
}

export function extraEnvHasGitToken(
  extraEnv: Record<string, string> | undefined,
): boolean {
  if (!extraEnv) {
    return false;
  }
  return GITHUB_TOKEN_KEYS.some((key) => {
    const value = extraEnv[key];
    return typeof value === "string" && value.length > 0;
  });
}

export function extraEnvGitToken(
  extraEnv: Record<string, string> | undefined,
): string | undefined {
  if (!extraEnv) {
    return undefined;
  }
  for (const key of GITHUB_TOKEN_KEYS) {
    const value = extraEnv[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
