/**
 * Railway healthchecks and edge routing use IPv6.
 * Binding `0.0.0.0` is IPv4-only, so probes never reach the process.
 */
export function resolveListenHost(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_ID) {
    return "::";
  }
  return env.HOST ?? "127.0.0.1";
}
