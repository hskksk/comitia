import { describe, expect, it } from "vitest";
import { resolveListenHost } from "./listen-host.js";

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
