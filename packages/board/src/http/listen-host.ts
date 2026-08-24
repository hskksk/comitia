import type { Server } from "node:http";

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

export function isIpv6Wildcard(host: string): boolean {
  return host === "::" || host === "::0";
}

/**
 * Bind the HTTP server. Dual-stack (`::`, ipv6Only: false) is only used for the
 * IPv6 wildcard — passing that listen options object for 127.0.0.1 changes
 * Node's accept path enough to flake A2A reconnect tests.
 */
export function listenBoardHttpServer(
  server: Server,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    if (isIpv6Wildcard(host)) {
      server.listen({ port, host, ipv6Only: false }, () => resolve());
      return;
    }
    server.listen(port, host, () => resolve());
  });
}
