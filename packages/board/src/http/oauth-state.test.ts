import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import {
  decodeOauthState,
  encodeOauthState,
} from "../http/oauth-state.js";

describe("oauth state", () => {
  it("round-trips return origin and client label", () => {
    const state = encodeOauthState("http://127.0.0.1:54321", "cli");
    expect(decodeOauthState(state)).toEqual({
      returnOrigin: "http://127.0.0.1:54321",
      clientLabel: "cli",
    });
  });

  it("keeps legacy origin-only state as web client", () => {
    const legacy = `nonce.${Buffer.from("http://localhost:5173").toString("base64url")}`;
    expect(decodeOauthState(legacy)).toEqual({
      returnOrigin: "http://localhost:5173",
      clientLabel: "web",
    });
  });
});
