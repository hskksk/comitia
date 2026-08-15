import { afterEach, describe, expect, it } from "vitest";
import { clearToken, getToken, setToken } from "./auth.js";

describe("auth token storage", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a token in sessionStorage", () => {
    expect(getToken()).toBeNull();
    setToken("comt_abc");
    expect(getToken()).toBe("comt_abc");
    clearToken();
    expect(getToken()).toBeNull();
  });
});
