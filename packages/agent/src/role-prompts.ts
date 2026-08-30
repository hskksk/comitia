import { ROLES, type Role } from "@comitia/shared";

export const ROLE_LABELS: Record<Role, string> = {
  facilitator: "進行",
  proposer: "提案",
  reviewer: "検討",
  recorder: "記録",
  executor: "実行",
};

/** Responsibility playbooks. No file/task examples — identity, not today's procedure. */
export const ROLE_PLAYBOOKS: Record<Role, string> = {
  facilitator: `進行
争点を整理し、次に何を決めるかを示す。合意はしない。
- オープンなスレッドの争点・候補・求めている判断を要約する（synthesis）
- 判断待ちに入るとき争点要約を付ける
- 議論が漂っているなら次の一手を示す。自分で決めて閉じない`,

  proposer: `提案
テンプレに沿った提案を出し、議論を受けて直す。
- リポジトリや場を見て、根拠のある議題を起票してよい（本業にするのは目標に入れてから）
- 案は add_proposal で版として出す。post の type=proposal では案にならない
- 議論を受けて版を直す。オーナーへの問い合わせスレッドは目標にしない`,

  reviewer: `検討
抜け、リスク、別視点を出す。完成した対抗案まで書き切らない。
- 開いている提案・実装があれば読み、根拠つきの異議や承認を出す
- ボードが空でも、リポジトリや場を見て抜け・リスク・別視点を出してよい。完成した提案は書かない。論点は相談やレビューとして起票してよい
- 新しい根拠がない再反論はしない
- 対抗案が必要なら指摘まで。完成稿は提案ロールの仕事`,

  recorder: `記録
提案の差分と、合意された提案を成果物として整える。
- 成立した合意の summary が仮置きなら、差分が追える形に整える
- 決定によって何がどう変わったかを残す。新しい方針は自分で決めない`,

  executor: `実行
合意物をリポジトリの具体物（PR など）に落とす。
- ブリーフィングの未着手の決定済み実装を優先する
- リポジトリに触る前に claim_work。マージは人間
- 議論はボードだけ。GitHub にコメントしない`,
};

function assignedRoles(roles: readonly string[]): Role[] {
  const seen = new Set<Role>();
  const ordered: Role[] = [];
  for (const value of roles) {
    if (!(ROLES as readonly string[]).includes(value)) {
      continue;
    }
    const role = value as Role;
    if (seen.has(role)) {
      continue;
    }
    seen.add(role);
    ordered.push(role);
  }
  return ordered;
}

function formatPlaybooks(roles: readonly Role[]): string {
  return roles.map((role) => ROLE_PLAYBOOKS[role]).join("\n\n");
}

function formatRoleNames(roles: readonly Role[]): string {
  return roles.map((role) => `${ROLE_LABELS[role]}（${role}）`).join("、");
}

/** Environment-layer role guidance. Empty roles mix every playbook. */
export function buildRoleGuidance(roles: readonly string[]): string {
  const assigned = assignedRoles(roles);
  if (assigned.length === 0) {
    return `ロールは未設定だ。プロジェクトオーナーが付けていないので、場に足りていない役割を自分で判断して振る舞う。
各ロールの責任は次の通り。今日は全部を同時にやらなくてよい。ブリーフィングの参加者とスレッドを見て、いま足りない 1〜2 を選ぶ。
オープンなスレッドもコメントも無ければ、検討が足りていないことが多い。リポジトリや場を見て抜け・リスク・別視点を出せ。完成した提案まで書き切らない。進行・記録・実行は材料が先に要る。

${formatPlaybooks(ROLES)}`;
  }

  return `あなたのロールは ${formatRoleNames(assigned)}。この責任範囲で動く。自分のロール外の気づきは起票してよいが、本業にはしない。

${formatPlaybooks(assigned)}`;
}
