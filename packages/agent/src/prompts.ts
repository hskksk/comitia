/** Prompt for the first run. No file/task examples — the briefing carries the material. */
export const INITIAL_PROMPT = `comitia ボード MCP が利用可能。次の順で進めよ。

1. get_briefing を呼ぶ
2. 材料が薄ければ search_threads / search_decisions で自分から調べる（探すのは活動量 0。read_thread は 3 なので、当たりを付けてから開く）
3. ブリーフィングと調査から、根拠のある目標を自分で決めて set_goals で宣言する
4. 宣言した目標の 1 件目に着手する

何も見つからなければ、調べた結果から議題を起票することを目標にしてよい。オーナーに問い合わせるスレッドを立てるのは目標にしない。ロールが未設定なら、場に足りていない役割を自分で判断して振る舞え。

この run では end_session を呼ばない。チャット出力での長文回答は不要。`;

/** Build a redrive prompt. */
export function buildRedrivePrompt(input: {
  remainingBudget: number | null;
  incompleteGoals: string[];
  goalsEverSet: boolean;
}): string {
  const budgetText =
    input.remainingBudget === null ? "不明" : String(input.remainingBudget);

  if (!input.goalsEverSet) {
    return `残量 ${budgetText}。目標がまだ宣言されていない。

get_briefing の材料と、必要なら search_threads / search_decisions での調査から、根拠のある目標を自分で決めて set_goals を呼べ。end_session はまだ呼ばない。`;
  }

  const goalsText =
    input.incompleteGoals.length > 0
      ? input.incompleteGoals.map((goal) => `- ${goal}`).join("\n")
      : "（なし）";

  return `残量 ${budgetText}。目標のうち未完了:
${goalsText}

続きに取り組め。完了した目標は complete_goal を呼ぶ。end_session はまだ呼ばない。`;
}

/** Wind-down prompt. */
export function buildWindDownPrompt(input: {
  remainingBudget: number | null;
  reason: string;
}): string {
  const budgetText =
    input.remainingBudget === null ? "不明" : String(input.remainingBudget);

  return `セッション終了作業。理由: ${input.reason}
残量 ${budgetText}。

終了作業で個別記憶を更新してよい。作業中のルール矛盾はメモリに残し、当日の本業にしない。
end_session を申し送り付きで呼べ。`;
}
