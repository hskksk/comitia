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
