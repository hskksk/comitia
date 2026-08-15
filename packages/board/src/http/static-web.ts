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
  return url.startsWith("/v1/") || url === "/healthz" || url.startsWith("/agents/");
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
    if (isApi(path) || req.headers.upgrade === "websocket") {
      for (const listener of previous) {
        listener(req, res);
      }
      return;
    }
    const relative = path === "/" ? "index.html" : path.slice(1);
    const candidate = resolve(join(dist, relative));
    const inside = candidate === dist || candidate.startsWith(dist + sep);
    const file =
      inside && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : join(dist, "index.html");
    if (!existsSync(file)) {
      for (const listener of previous) {
        listener(req, res);
      }
      return;
    }
    res.statusCode = 200;
    res.setHeader(
      "content-type",
      TYPES[extname(file)] ?? "application/octet-stream",
    );
    createReadStream(file).pipe(res);
  });
}

export function resolveWebDist(env = process.env): string | null {
  if (env.WEB_DIST) {
    return env.WEB_DIST;
  }
  const sibling = fileURLToPath(new URL("../../../web/dist", import.meta.url));
  if (existsSync(sibling)) {
    return sibling;
  }
  return null;
}
