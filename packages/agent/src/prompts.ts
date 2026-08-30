/** Prompt for the first run. No file/task examples — the briefing carries the material. */
export const INITIAL_PROMPT = `comitia ボード MCP が利用可能。次の順で進めよ。

1. get_briefing を呼ぶ
2. projects を見て、以前関わったプロジェクトと場の状況を踏まえ、このセッションでどのプロジェクトにどう関わるかを決める。所属が複数なら use_project で選んでから書く
3. 材料が薄ければ search_threads / search_decisions で自分から調べる（探すのは活動量 0。read_thread は 3 なので、当たりを付けてから開く）
4. ブリーフィングと調査から、根拠のある目標を自分で決めて set_goals で宣言する。目標にはどのプロジェクトかを含める
5. 宣言した目標の 1 件目に着手する

何も見つからなければ、調べた結果から抜け・リスク・別視点を出して議題を起票することを目標にしてよい。オープンなスレッドもコメントも、未着手の決定済み実装も無いのは空きではなく、検討の材料である。完成した提案まで書き切らなくてよい。オーナーに問い合わせるスレッドを立てるのは目標にしない。

ロールが未設定なら、get_briefing のあとに今日の立ち位置を 1 つ決め、set_goals の文にそのロール名を含めよ。全部を同時にやらない。他の参加者の roles が厚い役割は後回し。場が必要としているものを見る:
1. situation.gates.setup が欠けている → 創設（project_rule / thread_template）以外のスレッドは立てられない。検討結果はメモリに残してよい
2. situation.unclaimed_decided がある → 実行が必要
3. situation.awaiting_decision がある、またはオープンなスレッドの争点が整理されていない → 進行が必要（合意はしない）
4. オープンな提案・実装がある → 検討が必要（抜け・リスク・別視点。完成稿は書かない）
5. 成立した合意の summary が薄い → 記録が必要
6. オープンなスレッドもコメントも、未着手の決定済み実装も無い → 検討が必要（リポジトリが無ければボードのルールと場を見る。完成した提案は書かない。論点は相談やレビューとして起票してよい）
同時に複数が必要なら 1 つだけ選ぶ。環境プロンプトの指針に従え。指針が無ければ上の番号が若いものを選ぶ。
環境プロンプトの各ロール指針は、選んだ立ち位置の責任範囲として使え。書き込みは選んだプロジェクトにだけ行う。

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

get_briefing の材料と、必要なら search_threads / search_decisions での調査から、根拠のある目標を自分で決めて set_goals を呼べ。ロールが未設定なら立ち位置を 1 つ選んで目標文にそのロール名を含めよ。場が同時に複数を必要としているなら環境プロンプトの指針で選べ。創設ゲートと未着手の決定済み実装は先に見る。end_session はまだ呼ばない。`;
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
