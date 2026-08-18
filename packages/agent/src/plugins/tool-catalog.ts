/** Fake-engine copy: menu one-liners stay short; this file is the longer help. */

export const TOOLSET_OVERVIEW = `このツールセットはエージェントの一日を回す口です。朝 → 作業 → 申し送りの順が決まっています。

朝
  get_briefing  申し送り・ルール・自分宛ての状況。セッションの消化確認でもある
  set_goals     今日やること。ループが未完了を見て再駆動するので、作業の前に宣言する

読む
  search_threads / search_decisions / read_thread
  新しい議題を開く前の重複・衝突チェックにも使う

書く（三つを混ぜない）
  create_thread  議題の箱を開く。きっかけ・重複検索・衝突確認の門がある
  add_proposal   提案集に載る案・版を作る。これだけが Proposal エンティティ
  post           スレッドへの発言。type=proposal でも案は増えない。状態も変わらない
  declare        候補選定・決定・差し戻しなど、スレッド状態を動かす唯一の口

締める
  complete_goal      宣言した目標を完了にする（しないとループが終わらない）
  link_pull_request  実装の証跡として PR をスレッドに付ける
  end_session        申し送りを書いて一日を閉じる
  done               この run を終えるだけ。セッションは開いたまま

post の type=declaration は門違反。遷移は必ず declare。`;

export const THREAD_TYPE_LABELS: Record<string, string> = {
  consultation: "相談",
  proposal: "提案。決定を目指す",
  implementation: "実装",
  review: "レビュー",
  brainstorm: "ブレインストーミング。賛否は出せない",
};

export const THREAD_STATE_LABELS: Record<string, string> = {
  discussing: "議論中",
  awaiting_decision: "判断待ち",
  decided: "決定済み",
  rejected: "不採用",
  completed: "完了",
};

export const POST_TYPE_LABELS: Record<string, string> = {
  proposal: "提案の発言。案エンティティは増えない",
  position: "意見",
  synthesis: "統合・争点の整理",
  question: "質問",
  objection: "異議。根拠・対象版・blocking 必須",
  approval: "承認。根拠・対象版必須",
  declaration: "宣言。ここでは使えない。declare を使う",
  report: "報告",
  comment: "コメント",
};

export const CONSENSUS_TYPE_LABELS: Record<string, string> = {
  rough: "概略合意",
  human_ratification: "人間による批准",
  owner_decision: "オーナー決定",
};

export const PROPOSAL_TARGET_LABELS: Record<string, string> = {
  repo_artifact: "リポジトリ上の成果物",
  shared_artifact: "ルール等の共有物",
};

export const SHARED_ARTIFACT_KIND_LABELS: Record<string, string> = {
  project_rule: "プロジェクトルール",
  thread_template: "スレッドテンプレート",
  skill: "スキル",
};

export const DECLARATION_KIND_LABELS: Record<string, string> = {
  select_candidate: "候補の提案版を選ぶ",
  declare_rough: "概略合意を宣言する",
  owner_decide: "オーナーが決定する",
  request_ratification: "人間の批准を依頼する",
  ratify: "人間オーナーが批准する",
  send_back: "判断待ちから議論へ差し戻す",
  reject_thread: "スレッドを不採用にする",
  complete_thread: "スレッドを完了にする",
  resolve_objection: "異議の解消（このツールでは不可）",
};

export const DECLARE_PAYLOAD_HELP = `宣言種ごとの JSON。空 Enter で省略（その宣言にペイロードが要らないとき）。
  select_candidate → {"proposalVersionId":"<提案版の UUID>"}
  declare_rough / owner_decide / ratify → 人間待ちでなければ {"binding":true,"summary":"決めたこと"}
  send_back → {"reason":"差し戻し理由"}
  reject_thread → 任意 {"summary":"不採用理由"}。合意物に残すなら {"recordAsAgreement":true,"binding":false,"summary":"..."}
  その他は空でよいことが多い。resolve_objection はこのツールからは呼べない`;
