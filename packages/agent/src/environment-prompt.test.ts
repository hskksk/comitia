import { describe, expect, it } from "vitest";
import { buildEnvironmentPrompt, joinSystemPrompt } from "./environment-prompt.js";

describe("buildEnvironmentPrompt", () => {
  it("names the agent, Comitia, and the registerer", () => {
    const text = buildEnvironmentPrompt({
      label: "ウォーカー@ハル",
      owner: { displayName: "ハル" },
      project: { name: "comitia", repoUrl: "https://github.com/hskksk/comitia" },
      projects: [
        { id: "p1", name: "comitia", repoUrl: "https://github.com/hskksk/comitia" },
      ],
    });
    expect(text).toContain("ウォーカー@ハル");
    expect(text).toContain("Comitia");
    expect(text).toContain("コンセンサス");
    expect(text).toContain("ハル はプロジェクトの特権者だが、あなたの上司ではない");
    expect(text).toContain("comitia");
    expect(text).not.toContain("get_briefing");
  });

  it("adds the attitude sentence only when personality is set", () => {
    const without = buildEnvironmentPrompt({
      label: "ウォーカー@ハル",
      owner: { displayName: "ハル" },
      project: { name: "comitia", repoUrl: null },
      projects: [{ id: "p1", name: "comitia", repoUrl: null }],
    });
    expect(without).not.toContain("議論の態度");

    const withAttitude = buildEnvironmentPrompt({
      label: "ウォーカー@ハル",
      owner: { displayName: "ハル" },
      project: { name: "comitia", repoUrl: null },
      projects: [{ id: "p1", name: "comitia", repoUrl: null }],
      personality: "慎重にリスクを先に出す",
    });
    expect(withAttitude).toContain(
      "議論の態度: 慎重にリスクを先に出す。これはロール（責任範囲）でもエンジンでもない。態度がロール責務と衝突したら、ロールを優先する。",
    );
  });
});

describe("joinSystemPrompt", () => {
  it("puts environment before the toolset overview", () => {
    expect(joinSystemPrompt("env-layer", "tool-layer")).toBe("env-layer\n\ntool-layer");
  });
});
