import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function isApi(url: string): boolean {
  return (
    url === "/v1" ||
    url.startsWith("/v1/") ||
    url === "/healthz" ||
    url.startsWith("/agents/")
  );
}

function fallThrough(
  req: IncomingMessage,
  res: ServerResponse,
  previous: Array<(req: IncomingMessage, res: ServerResponse) => void>,
): void {
  if (res.headersSent || res.writableEnded) {
    res.end();
    return;
  }
  if (previous.length > 0) {
    for (const listener of previous) {
      listener(req, res);
    }
    return;
  }
  res.statusCode = 500;
  res.end();
}

export function attachSpaFallback(server: Server, webDist: string): void {
  const dist = resolve(webDist);
  const previous = server.listeners("request") as Array<
    (req: IncomingMessage, res: ServerResponse) => void
  >;
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    if (
      (req.method !== "GET" && req.method !== "HEAD") ||
      isApi(path) ||
      req.headers.upgrade === "websocket"
    ) {
      fallThrough(req, res, previous);
      return;
    }
    const relative = path === "/" ? "index.html" : path.slice(1);
    const candidate = resolve(join(dist, relative));
    const inside = candidate === dist || candidate.startsWith(dist + sep);
    let file: string;
    try {
      file =
        inside && existsSync(candidate) && statSync(candidate).isFile()
          ? candidate
          : join(dist, "index.html");
      if (!existsSync(file)) {
        fallThrough(req, res, previous);
        return;
      }
    } catch {
      fallThrough(req, res, previous);
      return;
    }
    res.statusCode = 200;
    res.setHeader(
      "content-type",
      TYPES[extname(file)] ?? "application/octet-stream",
    );
    try {
      const stream = createReadStream(file);
      stream.once("error", () => fallThrough(req, res, previous));
      stream.pipe(res);
    } catch {
      fallThrough(req, res, previous);
    }
  });
}

export function resolveWebDist(env = process.env): string | null {
  if (env.WEB_DIST) {
    return env.WEB_DIST;
  }
  const sibling = fileURLToPath(new URL("../../../web/dist", import.meta.url));
  try {
    if (existsSync(sibling)) {
      return sibling;
    }
  } catch {
    return null;
  }
  return null;
}
