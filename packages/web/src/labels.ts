const threadTypeLabels: Record<string, string> = {
  consultation: "相談",
  proposal: "提案",
  implementation: "実装",
  review: "レビュー",
  brainstorm: "ブレインストーミング",
};

const threadStateLabels: Record<string, string> = {
  discussing: "議論中",
  awaiting_decision: "判断待ち",
  decided: "決定済み",
  rejected: "不採用",
  completed: "完了",
};

const workPhaseLabels: Record<string, string> = {
  unclaimed: "未着手",
  in_progress: "実装中",
  in_review: "レビュー中",
  merged: "マージ済み",
};

const consensusTypeLabels: Record<string, string> = {
  rough: "概略合意",
  human_ratification: "人間による批准",
  owner_decision: "オーナー決定",
};

const postTypeLabels: Record<string, string> = {
  proposal: "提案",
  position: "意見",
  synthesis: "統合",
  question: "質問",
  objection: "異議",
  approval: "承認",
  declaration: "宣言",
  report: "報告",
  comment: "コメント",
};

function labelOf(labels: Record<string, string>, value: string | null): string {
  return value === null ? "なし" : (labels[value] ?? "未分類");
}

export function threadTypeLabel(value: string): string {
  return labelOf(threadTypeLabels, value);
}

export function threadStateLabel(value: string): string {
  return labelOf(threadStateLabels, value);
}

export function workPhaseLabel(value: string): string {
  return labelOf(workPhaseLabels, value);
}

export function consensusTypeLabel(value: string | null): string {
  return labelOf(consensusTypeLabels, value);
}

export function postTypeLabel(value: string): string {
  return labelOf(postTypeLabels, value);
}

const pullRequestStateLabels: Record<string, string> = {
  open: "オープン",
  merged: "マージ済み",
  closed: "クローズ",
};

export function pullRequestStateLabel(value: string): string {
  return labelOf(pullRequestStateLabels, value);
}

export function credentialClientLabel(value: string): string {
  const labels: Record<string, string> = {
    web: "Web",
    cli: "CLI",
    init: "初期化",
    register: "登録",
    manual: "手動入力",
    agent: "エージェント",
  };
  return labels[value] ?? value;
}

export function engineLabel(engine: string | null): string {
  if (engine === "fake") {
    return "fake（人間が操作）";
  }
  if (engine === "opencode") {
    return "OpenCode";
  }
  if (engine === "cursor-agent") {
    return "Cursor Agent";
  }
  return engine ?? "";
}

/** One-line "what we need" for queue cards (M6-1 / M6-2). */
export function judgmentNeedLabel(consensusType: string | null): string {
  switch (consensusType) {
    case "human_ratification":
      return "人間批准が必要です";
    case "owner_decision":
      return "オーナー決定が必要です";
    case "rough":
      return "概略合意の判断が必要です";
    default:
      return "判断が必要です";
  }
}
