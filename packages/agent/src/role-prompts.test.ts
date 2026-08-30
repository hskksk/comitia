import { describe, expect, it } from "vitest";
import { ROLE_PLAYBOOKS, buildRoleGuidance } from "./role-prompts.js";

describe("buildRoleGuidance", () => {
  it("mixes every playbook when no role is assigned", () => {
    const text = buildRoleGuidance([]);
    expect(text).toContain("ロールは未設定");
    expect(text).toContain("立ち位置を 1 つ選ぶ");
    expect(text).toContain("選び方は run プロンプトにある");
    expect(text).not.toContain("検討が足りていないことが多い");
    for (const playbook of Object.values(ROLE_PLAYBOOKS)) {
      expect(text).toContain(playbook);
    }
  });

  it("keeps only assigned playbooks, in the given order", () => {
    const text = buildRoleGuidance(["executor", "facilitator"]);
    expect(text).toContain("あなたのロールは 実行（executor）、進行（facilitator）");
    expect(text).toContain(ROLE_PLAYBOOKS.executor);
    expect(text).toContain(ROLE_PLAYBOOKS.facilitator);
    expect(text).not.toContain(ROLE_PLAYBOOKS.proposer);
    expect(text.indexOf(ROLE_PLAYBOOKS.executor)).toBeLessThan(
      text.indexOf(ROLE_PLAYBOOKS.facilitator),
    );
  });

  it("ignores unknown names and still mixes when nothing valid remains", () => {
    expect(buildRoleGuidance(["mascot"])).toContain("ロールは未設定");
    const text = buildRoleGuidance(["mascot", "reviewer"]);
    expect(text).toContain("あなたのロールは 検討（reviewer）");
    expect(text).toContain(ROLE_PLAYBOOKS.reviewer);
    expect(text).not.toContain(ROLE_PLAYBOOKS.recorder);
  });
});
