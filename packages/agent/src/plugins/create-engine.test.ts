import { describe, expect, it } from "vitest";
import { normalizeEngineModel } from "../config.js";
import { createEnginePlugin } from "./create-engine.js";

describe("normalizeEngineModel", () => {
  it("keeps a non-empty model id for every engine", () => {
    expect(normalizeEngineModel("composer-2.5")).toBe("composer-2.5");
    expect(normalizeEngineModel("opencode/gpt-5")).toBe("opencode/gpt-5");
    expect(normalizeEngineModel("claude-opus-4")).toBe("claude-opus-4");
  });

  it("treats missing or blank values as the engine default", () => {
    expect(normalizeEngineModel(undefined)).toBeUndefined();
    expect(normalizeEngineModel("")).toBeUndefined();
    expect(normalizeEngineModel("   ")).toBeUndefined();
  });
});

describe("createEnginePlugin model option", () => {
  it("accepts --model for coding engines and ignores it for fake", () => {
    expect(
      createEnginePlugin({
        engine: "cursor-agent",
        callTool: async () => ({ content: [] }),
        model: "composer-2.5",
      }).run,
    ).toBeTypeOf("function");
    expect(
      createEnginePlugin({
        engine: "opencode",
        callTool: async () => ({ content: [] }),
        model: "opencode/gpt-5",
      }).run,
    ).toBeTypeOf("function");
    expect(
      createEnginePlugin({
        engine: "claude-code",
        callTool: async () => ({ content: [] }),
        model: "claude-opus-4",
      }).run,
    ).toBeTypeOf("function");
    expect(
      createEnginePlugin({
        engine: "fake",
        callTool: async () => ({ content: [] }),
        model: "composer-2.5",
      }).start,
    ).toBeTypeOf("function");
  });
});
