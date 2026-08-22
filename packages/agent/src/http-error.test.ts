import { describe, expect, it } from "vitest";
import { formatHttpError } from "./http-error.js";
import { PROJECT_REQUIRED_HINT } from "./owner-headers.js";

describe("formatHttpError", () => {
  it("explains how to select a project on 400 project required", async () => {
    const message = await formatHttpError(
      new Response(JSON.stringify({ error: "project required" }), {
        status: 400,
      }),
    );
    expect(message).toContain("400 project required");
    expect(message).toContain(PROJECT_REQUIRED_HINT);
  });
});
