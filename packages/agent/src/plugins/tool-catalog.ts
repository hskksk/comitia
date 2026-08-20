import { DEFAULT_MUTATING_TOOL_COST, TOOL_COSTS } from "@comitia/shared";

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

着手（リポジトリに触る前に）
  claim_work        paths（prefix の配列）を宣言する。重なる他者の着手は結果に出るが止まらない。空配列は拒否（全部なら ["."]）
  release_work      自分の着手を解除する
  list_work_claims  プロジェクトの active な着手を見る（検索扱い）

記憶とメモ
  write_memory   本業でない気づき・ルール矛盾は個別記憶に残す。他者には見えない。朝の get_briefing で自分に返る
  write_note     公開メモ（既定）または非公開メモを書く。所有権は移らない
  search_notes   公開メモと自分の非公開メモを探す（検索扱い）
  read_note      メモを読む。非公開は本人のみ
  comment_note   公開メモに助言のコメントを付ける

締める
  complete_goal      宣言した目標を完了にする（しないとループが終わらない）
  link_pull_request  実装の証跡として PR をスレッドに付ける
  end_session        申し送りを書いて一日を閉じる
  done               この run を終えるだけ。セッションは開いたまま

post の type=declaration は門違反。遷移は必ず declare。

活動量の単価: 探す（get_briefing・search_threads・search_decisions・list_work_claims・search_notes）は ${TOOL_COSTS.get_briefing}、read_thread は ${TOOL_COSTS.read_thread}（read_note も同額）、書く操作は ${DEFAULT_MUTATING_TOOL_COST}。`;

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
  unanimous: "全員賛成（票が揃うまで）",
  no_objection: "異議なし（最低24時間）",
  silence: "沈黙期限（48時間）",
};

export const ENGINE_DIVERSITY_LABELS: Record<string, string> = {
  off: "off（人ごとに1）",
  collapse_same_engine: "同一エンジンは1と数える",
  require_other_engine: "エンジン2種以上必須",
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
  ratify: "人間オーナーが批准する（候補版の著者本人は不可）",
  send_back: "判断待ちから議論へ差し戻す",
  reject_thread: "スレッドを不採用にする",
  complete_thread: "スレッドを完了にする",
  resolve_objection: "異議の解消。このツールでは不可",
  extend_window: "窓・期限を延長する（スレッドオーナー）",
  shorten_window: "窓・期限を短縮する（プロジェクトオーナー）",
  clock_satisfy: "時計による成立宣言。システム参加者のみ",
};

export const DECLARE_PAYLOAD_HELP = `宣言種ごとの JSON。空 Enter で省略（その宣言にペイロードが要らないとき）。
  select_candidate → {"proposalVersionId":"<提案版の UUID>"}
  declare_rough / owner_decide / ratify → 人間待ちでなければ {"binding":true,"summary":"決めたこと"}
  send_back → {"reason":"差し戻し理由"}
  reject_thread → 任意 {"summary":"不採用理由"}。合意物に残すなら {"recordAsAgreement":true,"binding":false,"summary":"..."}
  extend_window / shorten_window → {"hours":<新しい窓・期限の長さ>}
  その他は空でよいことが多い。resolve_objection と clock_satisfy はこのツールからは呼べない`;
