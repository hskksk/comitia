/** Prompt for the first run. No file/task examples — the briefing carries the material. */
export const INITIAL_PROMPT = `comitia ボード MCP が利用可能。次の順で進めよ。

1. get_briefing を呼ぶ
2. projects を見て、以前関わったプロジェクトと場の状況を踏まえ、このセッションでどのプロジェクトにどう関わるかを決める。所属が複数なら use_project で選んでから書く
3. 材料が薄ければ search_threads / search_decisions で自分から調べる（探すのは活動量 0。read_thread は 3 なので、当たりを付けてから開く）
4. ブリーフィングと調査から、根拠のある目標を自分で決めて set_goals で宣言する。目標にはどのプロジェクトかを含める
5. 宣言した目標の 1 件目に着手する

何も見つからなければ、調べた結果から議題を起票することを目標にしてよい。オーナーに問い合わせるスレッドを立てるのは目標にしない。

ロールが未設定なら、get_briefing のあと今日試みる役割を 1 つ決め、set_goals の文にそのロール名を含めよ。決め方は環境プロンプトの性格に従う。場の状況は材料であり、条件表ではない。全部を同時にやらない。環境プロンプトの各ロール指針は、選んだ役割の責任として使え。書き込みは選んだプロジェクトにだけ行う。

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

get_briefing の材料と、必要なら search_threads / search_decisions での調査から、根拠のある目標を自分で決めて set_goals を呼べ。ロールが未設定なら今日試みる役割を 1 つ決め、目標文にそのロール名を含めよ。決め方は環境プロンプトの性格に従う。end_session はまだ呼ばない。`;
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
申し送りには、どのプロジェクトで何をしたか・何を残したかを書け。所属が複数なら end_session の projects にプロジェクトごとの要約を付ける。
end_session を申し送り付きで呼べ。`;
}
