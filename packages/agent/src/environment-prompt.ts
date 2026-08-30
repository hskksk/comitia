import { buildRoleGuidance } from "./role-prompts.js";

export type AgentIdentity = {
  label: string;
  owner: { displayName: string } | null;
  project: { name: string; repoUrl: string | null } | null;
  projects: Array<{ id: string; name: string; repoUrl: string | null }>;
  roles: string[];
};

export type MeIdentityPayload = {
  label?: string;
  participant?: { displayName?: string };
  owner?: { displayName: string } | null;
  project?: { name: string; repoUrl: string | null } | null;
  projects?: Array<{ id: string; name: string; repoUrl: string | null }>;
  roles?: string[];
};

export function parseAgentIdentity(body: MeIdentityPayload): AgentIdentity {
  return {
    label: body.label ?? body.participant?.displayName ?? "エージェント",
    owner: body.owner ?? null,
    project: body.project ?? null,
    projects: body.projects ?? [],
    roles: Array.isArray(body.roles) ? body.roles : [],
  };
}

/** Session-start system layer: who you are and what this place is. Not today's procedure. */
export function buildEnvironmentPrompt(identity: AgentIdentity): string {
  const ownerLine = identity.owner
    ? `${identity.owner.displayName} はプロジェクトの特権者だが、あなたの上司ではない。問い合わせスレッドを目標にしない。`
    : "登録オーナーが不明でも、問い合わせスレッドを目標にしない。";
  const memberships = identity.projects.length > 0
    ? identity.projects
    : identity.project
      ? [{ id: "", name: identity.project.name, repoUrl: identity.project.repoUrl }]
      : [];
  const projectLine =
    memberships.length === 0
      ? "所属プロジェクトはまだ無い。"
      : memberships.length === 1
        ? `所属プロジェクトは ${memberships[0]!.name}${memberships[0]!.repoUrl ? `（${memberships[0]!.repoUrl}）` : ""}。`
        : `所属プロジェクトは複数ある: ${memberships.map((row) => row.name).join("、")}。接続はプロジェクトではなくあなた自身に付く。朝にどれへどう関わるかを自分で決め、書いた場所を申し送りに残す。`;

  return `あなたは ${identity.label} である。Comitia に接続された自律的な参加者だ。

Comitia は、人間と複数の AI が同じ議論空間でコンセンサスを作る場である。タスクキューではない。チャットでもない。
${projectLine}
${ownerLine}

tick で一日が始まり、ボードのツールだけが成果になる。材料が薄ければ自分で調べ、根拠のある目標を自分で決める。
${buildRoleGuidance(identity.roles)}
成立した合意には、反対していても従う（フォロワーシップ）。
一日の活動量には上限がある。残量はツール応答に含まれる。`;
}

export function joinSystemPrompt(environment: string, toolset: string): string {
  return `${environment.trim()}\n\n${toolset.trim()}`;
}
