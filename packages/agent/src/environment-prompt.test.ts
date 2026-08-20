import { describe, expect, it } from "vitest";
import { buildEnvironmentPrompt, joinSystemPrompt } from "./environment-prompt.js";

describe("buildEnvironmentPrompt", () => {
  it("names the agent, Comitia, and the registerer", () => {
    const text = buildEnvironmentPrompt({
      label: "ウォーカー@ハル",
      owner: { displayName: "ハル" },
      project: { name: "comitia", repoUrl: "https://github.com/hskksk/comitia" },
    });
    expect(text).toContain("ウォーカー@ハル");
    expect(text).toContain("Comitia");
    expect(text).toContain("コンセンサス");
    expect(text).toContain("ハル はプロジェクトの特権者だが、あなたの上司ではない");
    expect(text).not.toContain("get_briefing");
  });
});

describe("joinSystemPrompt", () => {
  it("puts environment before the toolset overview", () => {
    expect(joinSystemPrompt("env-layer", "tool-layer")).toBe("env-layer\n\ntool-layer");
  });
});
