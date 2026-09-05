import { afterEach, describe, expect, it, vi } from "vitest";

describe("healthPayload", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("prefers COMITIA_VERSION over package.json", async () => {
    vi.stubEnv("COMITIA_VERSION", "9.9.9");
    const { healthPayload } = await import("./version.js");
    expect(healthPayload()).toEqual({ ok: true, version: "9.9.9" });
  });

  it("includes a short commit when RAILWAY_GIT_COMMIT_SHA is set", async () => {
    vi.stubEnv("COMITIA_VERSION", "1.2.3");
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "abcdef1234567890");
    const { healthPayload } = await import("./version.js");
    expect(healthPayload()).toEqual({
      ok: true,
      version: "1.2.3",
      commit: "abcdef1",
    });
  });
});
