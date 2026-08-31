import { describe, expect, it } from "vitest";
import { ROLE_PLAYBOOKS } from "./role-prompts.js";
import {
  buildEnvironmentPrompt,
  joinSystemPrompt,
  parseAgentIdentity,
} from "./environment-prompt.js";

const baseIdentity = {
  label: "ウォーカー@ハル",
  owner: { displayName: "ハル" },
  project: { name: "comitia", repoUrl: "https://github.com/hskksk/comitia" },
  projects: [
    { id: "p1", name: "comitia", repoUrl: "https://github.com/hskksk/comitia" },
  ],
};

describe("buildEnvironmentPrompt", () => {
  it("names the agent, Comitia, and the registerer", () => {
    const text = buildEnvironmentPrompt({ ...baseIdentity, roles: [] });
    expect(text).toContain("ウォーカー@ハル");
    expect(text).toContain("Comitia");
    expect(text).toContain("コンセンサス");
    expect(text).toContain("ハル はプロジェクトの特権者だが、あなたの上司ではない");
    expect(text).toContain("comitia");
    expect(text).not.toContain("get_briefing");
  });

  it("mixes every role playbook when no role is assigned", () => {
    const text = buildEnvironmentPrompt({ ...baseIdentity, roles: [] });
    expect(text).toContain("ロールは未設定");
    expect(text).toContain("選び方自体にも効く");
    expect(text).toContain("性格に合うロールを選ぶのではない");
    expect(text).not.toContain("situation.unclaimed_decided");
    expect(text).not.toContain("場に足りない役割を判断して振る舞う");
    expect(text).toContain(ROLE_PLAYBOOKS.facilitator);
    expect(text).toContain(ROLE_PLAYBOOKS.proposer);
    expect(text).toContain(ROLE_PLAYBOOKS.reviewer);
    expect(text).toContain(ROLE_PLAYBOOKS.recorder);
    expect(text).toContain(ROLE_PLAYBOOKS.executor);
  });

  it("keeps only the assigned role playbook", () => {
    const text = buildEnvironmentPrompt({
      ...baseIdentity,
      roles: ["proposer"],
    });
    expect(text).toContain("あなたのロールは 提案（proposer）");
    expect(text).toContain(ROLE_PLAYBOOKS.proposer);
    expect(text).not.toContain("ロールは未設定");
    expect(text).not.toContain(ROLE_PLAYBOOKS.executor);
    expect(text).not.toContain(ROLE_PLAYBOOKS.facilitator);
  });

  it("adds the personality sentence only when set", () => {
    const without = buildEnvironmentPrompt({ ...baseIdentity, roles: [] });
    expect(without).not.toContain("性格:");

    const withPersonality = buildEnvironmentPrompt({
      ...baseIdentity,
      roles: ["executor"],
      personality: "慎重にリスクを先に出す",
    });
    expect(withPersonality).toContain(
      "性格: 慎重にリスクを先に出す。行い方のスタイルであり、ロールでもエンジンでもない。",
    );
    expect(withPersonality).toContain("役割そのものを変えない");
    expect(withPersonality).not.toContain("議論の態度");
  });
});

describe("parseAgentIdentity", () => {
  it("passes roles through from GET /v1/me", () => {
    expect(
      parseAgentIdentity({
        label: "ウォーカー@ハル",
        roles: ["reviewer"],
      }).roles,
    ).toEqual(["reviewer"]);
  });

  it("defaults missing roles to an empty list so the mix applies", () => {
    expect(parseAgentIdentity({ label: "ウォーカー@ハル" }).roles).toEqual([]);
  });

  it("passes personality from the participant", () => {
    expect(
      parseAgentIdentity({
        label: "ウォーカー@ハル",
        participant: {
          displayName: "ウォーカー",
          personality: "対立する案を残す",
        },
      }).personality,
    ).toBe("対立する案を残す");
  });
});

describe("joinSystemPrompt", () => {
  it("puts environment before the toolset overview", () => {
    expect(joinSystemPrompt("env-layer", "tool-layer")).toBe("env-layer\n\ntool-layer");
  });
});
