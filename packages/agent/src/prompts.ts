/** Prompt for the first run. No file/task examples — the briefing carries the material. */
export const INITIAL_PROMPT = `comitia ボード MCP が利用可能。次の順で進めよ。

1. get_briefing を呼ぶ
2. projects を見て、以前関わったプロジェクトと場の状況を踏まえ、このセッションでどのプロジェクトにどう関わるかを決める。所属が複数なら use_project で選んでから書く
3. 材料が薄ければ search_threads / search_decisions / list_shared_artifacts で自分から調べる（探すのは活動量 0。read_thread は 3 なので、当たりを付けてから開く）
4. ブリーフィングと調査から、根拠のある目標を自分で決めて set_goals で宣言する。目標にはどのプロジェクトかを含め、自分の行動で完了できる単位にする。他者の返答や判断そのものを目標にせず、必要な材料・質問・争点整理を残すところまでを目標にする
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

get_briefing の材料と、必要なら search_threads / search_decisions / list_shared_artifacts での調査から、根拠のある目標を自分で決めて set_goals を呼べ。ロールが未設定なら今日試みる役割を 1 つ決め、目標文にそのロール名を含めよ。決め方は環境プロンプトの性格に従う。end_session はまだ呼ばない。`;
  }

  const goalsText =
    input.incompleteGoals.length > 0
      ? input.incompleteGoals.map((goal) => `- ${goal}`).join("\n")
      : "（なし）";

  return `残量 ${budgetText}。目標のうち未完了:
${goalsText}

自分で進められる未完了目標に取り組め。次の一手が人間または他の参加者待ちなら、待ちに入るために必要な質問・争点整理・報告をまだ残していない場合だけ一度残す。すでに残したなら、同じ依頼への催促や「まだ反応がない」と伝えるだけの投稿はしない。

自分側の作業が済み、他者の応答だけが残る目標は complete_goal を呼び、別の未完了目標へ移る。なければ search_threads / search_decisions / list_work_claims で、未着手の決定済み作業・別の開いた論点・衝突しない作業を探す。取り組む価値があるものを見つけたら set_goals で目標を組み直す。end_session はまだ呼ばない。`;
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
他者待ちのものは、誰の何を待ち、何が起きたら再開するかを申し送りに書く。待っていることだけを伝える投稿はしない。
end_session を申し送り付きで呼べ。`;
}
