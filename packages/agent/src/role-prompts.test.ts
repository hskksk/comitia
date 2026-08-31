import { describe, expect, it } from "vitest";
import { ROLE_PLAYBOOKS, buildRoleGuidance } from "./role-prompts.js";

describe("buildRoleGuidance", () => {
  it("mixes every playbook when no role is assigned, without a condition table", () => {
    const text = buildRoleGuidance([]);
    expect(text).toContain("ロールは未設定");
    expect(text).toContain("選び方自体にも効く");
    expect(text).toContain("性格に合うロールを選ぶのではない");
    expect(text).not.toContain("議論の態度があるとき");
    expect(text).not.toContain("situation.unclaimed_decided");
    for (const playbook of Object.values(ROLE_PLAYBOOKS)) {
      expect(text).toContain(playbook);
    }
  });

  it("keeps only assigned playbooks, in the given order", () => {
    const text = buildRoleGuidance(["executor", "facilitator"]);
    expect(text).toContain("あなたのロールは 実行（executor）、進行（facilitator）");
    expect(text).toContain("遂行すべく行動を試みる");
    expect(text).toContain("役割そのものを変えない");
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
