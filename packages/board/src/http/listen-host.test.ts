import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  listenBoardHttpServer,
  resolveListenHost,
} from "./listen-host.js";

describe("resolveListenHost", () => {
  it("defaults to loopback for local tests", () => {
    expect(resolveListenHost({})).toBe("127.0.0.1");
  });

  it("keeps compose IPv4 wildcard off Railway", () => {
    expect(resolveListenHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("binds dual-stack on Railway even if HOST is 0.0.0.0", () => {
    expect(
      resolveListenHost({ RAILWAY_ENVIRONMENT: "production", HOST: "0.0.0.0" }),
    ).toBe("::");
    expect(resolveListenHost({ RAILWAY_ENVIRONMENT_ID: "abc" })).toBe("::");
  });

  it("keeps an explicit local host", () => {
    expect(resolveListenHost({ HOST: "127.0.0.1" })).toBe("127.0.0.1");
  });
});

describe("listenBoardHttpServer", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  });

  it("IPv4 loopback serves 127.0.0.1", async () => {
    const server = createServer((_req, res) => {
      res.end("ok");
    });
    servers.push(server);
    await listenBoardHttpServer(server, 0, "127.0.0.1");
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("server address is unavailable");
    }
    const response = await fetch(`http://127.0.0.1:${addr.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it(":: with ipv6Only false serves IPv4 and IPv6 loopback", async () => {
    const server = createServer((_req, res) => {
      res.end("ok");
    });
    servers.push(server);
    try {
      await listenBoardHttpServer(server, 0, "::");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("EAFNOSUPPORT") || message.includes("EADDRNOTAVAIL")) {
        return;
      }
      throw error;
    }
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("server address is unavailable");
    }
    const ipv4 = await fetch(`http://127.0.0.1:${addr.port}/`);
    expect(ipv4.status).toBe(200);
    expect(await ipv4.text()).toBe("ok");
    const ipv6 = await fetch(`http://[::1]:${addr.port}/`);
    expect(ipv6.status).toBe(200);
    expect(await ipv6.text()).toBe("ok");
  });
});
