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
  it("serves SPA routes and leaves API, agent, and non-GET routes to prior listeners", async () => {
    const dir = join(tmpdir(), `comitia-web-${Date.now()}`);
    mkdirSync(dir);
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Comitia</title>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "console.log('app');");

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
      expect(spa.headers.get("cache-control")).toBe("no-cache");

      const asset = await fetch(`${base}/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );

      const health = await fetch(`${base}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const me = await fetch(`${base}/v1/me`);
      expect(me.status).toBe(401);
      expect(me.headers.get("content-type")).toContain("application/json");

      const apiRoot = await fetch(`${base}/v1`);
      expect(await apiRoot.text()).not.toContain("Comitia");

      const agent = await fetch(`${base}/agents/x/`);
      expect(agent.status).not.toBe(200);
      expect(await agent.text()).not.toContain("Comitia");

      const post = await fetch(`${base}/threads/abc`, { method: "POST" });
      expect(post.status).not.toBe(200);
      expect(await post.text()).not.toContain("Comitia");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
