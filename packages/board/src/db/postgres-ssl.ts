const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db"]);

export function postgresHostFromUrl(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname || null;
  } catch {
    const match = /@([^/:?]+)/.exec(databaseUrl);
    return match?.[1] ?? null;
  }
}

/** Local compose / Railway private network do not need TLS. Public hosts do. */
export function hostedPostgresNeedsTls(databaseUrl: string): boolean {
  const hostname = postgresHostFromUrl(databaseUrl);
  if (!hostname) {
    return false;
  }
  if (LOCAL_HOSTS.has(hostname)) {
    return false;
  }
  if (hostname.endsWith(".railway.internal")) {
    return false;
  }
  return true;
}

export function postgresSslOption(
  databaseUrl: string,
): { rejectUnauthorized: boolean } | undefined {
  if (!hostedPostgresNeedsTls(databaseUrl)) {
    return undefined;
  }
  return { rejectUnauthorized: false };
}
