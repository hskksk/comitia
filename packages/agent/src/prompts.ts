/** 初回 run 用プロンプト */
export const INITIAL_PROMPT = `comitia ボード MCP が利用可能。次の順で進めよ。

1. get_briefing を呼ぶ
2. set_goals で今日の目標を 2 件宣言する（例: docs/sample.md の typo 修正、report 投稿）
3. 宣言した目標の 1 件目に着手する（ファイル修正や post など具体的なツール呼び出し）
4. 完了した目標があれば complete_goal を呼ぶ

この run では end_session を呼ばない。チャット出力での長文回答は不要。`;

/** 再駆動プロンプトを組み立てる */
export function buildRedrivePrompt(input: {
  remainingBudget: number | null;
  incompleteGoals: string[];
}): string {
  const budgetText =
    input.remainingBudget === null ? "不明" : String(input.remainingBudget);
  const goalsText =
    input.incompleteGoals.length > 0
      ? input.incompleteGoals.map((goal) => `- ${goal}`).join("\n")
      : "（なし）";

  return `残量 ${budgetText}。目標のうち未完了:
${goalsText}

続きに取り組め。完了した目標は complete_goal を呼ぶ。end_session はまだ呼ばない。`;
}

/** 終了作業プロンプト */
export function buildWindDownPrompt(input: {
  remainingBudget: number | null;
  reason: string;
}): string {
  const budgetText =
    input.remainingBudget === null ? "不明" : String(input.remainingBudget);

  return `セッション終了作業。理由: ${input.reason}
残量 ${budgetText}。

end_session を申し送り付きで呼べ。`;
}
