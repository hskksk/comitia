import { describe, expect, it } from "vitest";
import { resolveEngineModel } from "./create-engine.js";

describe("resolveEngineModel", () => {
  it("reads the same COMITIA_*_MODEL override for OpenCode, Cursor, and Claude", () => {
    expect(
      resolveEngineModel("opencode", { COMITIA_OPENCODE_MODEL: "opencode/gpt-5" }),
    ).toBe("opencode/gpt-5");
    expect(
      resolveEngineModel("cursor-agent", { COMITIA_CURSOR_MODEL: "composer-2.5" }),
    ).toBe("composer-2.5");
    expect(
      resolveEngineModel("claude-code", { COMITIA_CLAUDE_MODEL: "claude-opus-4" }),
    ).toBe("claude-opus-4");
  });

  it("treats missing or empty values as the engine default", () => {
    expect(resolveEngineModel("opencode", {})).toBeUndefined();
    expect(resolveEngineModel("cursor-agent", { COMITIA_CURSOR_MODEL: "" })).toBeUndefined();
    expect(resolveEngineModel("claude-code", {})).toBeUndefined();
    expect(resolveEngineModel("fake", { COMITIA_OPENCODE_MODEL: "x" })).toBeUndefined();
  });
});
