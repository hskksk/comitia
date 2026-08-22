import { describe, expect, it } from "vitest";
import {
  buildOAuthStartUrl,
  startOAuthCallbackServer,
} from "./oauth-callback.js";

describe("oauth callback server", () => {
  it("captures a token from /login/callback", async () => {
    const server = await startOAuthCallbackServer({ timeoutMs: 5_000 });
    try {
      const response = await fetch(
        `${server.callbackOrigin}/login/callback?token=comt_test_token`,
      );
      expect(response.status).toBe(200);
      expect(await server.waitForToken()).toBe("comt_test_token");
    } finally {
      server.close();
    }
  });

  it("builds the GitHub OAuth start URL", () => {
    expect(
      buildOAuthStartUrl(
        "http://127.0.0.1:8787",
        "http://127.0.0.1:54321",
      ),
    ).toBe(
      "http://127.0.0.1:8787/v1/auth/github?return_origin=http%3A%2F%2F127.0.0.1%3A54321&client=cli",
    );
  });
});
