import "../test/helpers.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { createBoardApp } from "./app.js";
import { attachSpaFallback } from "./static-web.js";

describe("SPA fallback", () => {
  it("serves index.html for / and leaves /healthz to the API", async () => {
    const dir = join(tmpdir(), `comitia-web-${Date.now()}`);
    mkdirSync(dir);
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Comitia</title>");

    const app = createBoardApp({ db });
    const server = createServer(getRequestListener(app.fetch));
    attachSpaFallback(server, dir);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("listen failed");
    }
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const spa = await fetch(`${base}/threads/abc`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("Comitia");

      const health = await fetch(`${base}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
