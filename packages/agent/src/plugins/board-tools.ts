import {
  CONSENSUS_TYPES,
  DECLARATION_KINDS,
  ENGINE_DIVERSITY,
  POST_TYPES,
  PROPOSAL_TARGETS,
  SHARED_ARTIFACT_KINDS,
  THREAD_STATES,
  THREAD_TYPES,
} from "@comitia/shared";
import { MCP_PROXY_TOOLS, type McpProxyToolResult } from "../mcp-proxy.js";
import {
  CONSENSUS_TYPE_LABELS,
  DECLARE_PAYLOAD_HELP,
  DECLARATION_KIND_LABELS,
  ENGINE_DIVERSITY_LABELS,
  POST_TYPE_LABELS,
  PROPOSAL_TARGET_LABELS,
  SHARED_ARTIFACT_KIND_LABELS,
  THREAD_STATE_LABELS,
  THREAD_TYPE_LABELS,
  TOOLSET_OVERVIEW,
} from "./tool-catalog.js";

export { TOOLSET_OVERVIEW } from "./tool-catalog.js";

export type ToolFieldKind =
  | "string"
  | "uuid"
  | "boolean"
  | "string[]"
  | "enum"
  | "json"
  | "url";

export interface ToolFieldSpec {
  name: string;
  description: string;
  required: boolean;
  kind: ToolFieldKind;
  enumValues?: readonly string[];
  enumLabels?: Record<string, string>;
}

export interface BoardToolSpec {
  name: (typeof MCP_PROXY_TOOLS)[number];
  /** One line in the tool menu. */
  summary: string;
  /** Shown when the tool is selected, and by `help <name>`. */
  description: string;
  fields: ToolFieldSpec[];
}

export interface ToolPromptHints {
  lastThreadId?: string;
  goals: Array<{ id: string; text: string }>;
}

export type RunCommand =
  | { kind: "done" }
  | { kind: "help" }
  | { kind: "help-tool"; query: string }
  | { kind: "tool"; name: string; args?: Record<string, unknown> }
  | { kind: "error"; message: string };

/** Line returned by TTY / scripted I/O when Escape is pressed. */
export const ESCAPE_LINE = "\x1b";

export class PromptCancelled extends Error {
  constructor() {
    super("prompt cancelled");
    this.name = "PromptCancelled";
  }
}

export function isEscapeLine(line: string): boolean {
  return line === ESCAPE_LINE;
}

export function isPromptCancelled(error: unknown): boolean {
  return error instanceof PromptCancelled;
}

export async function askOrCancel(
  ask: (question: string) => Promise<string>,
  question: string,
): Promise<string> {
  const line = await ask(question);
  if (isEscapeLine(line)) {
    throw new PromptCancelled();
  }
  return line;
}

export const BOARD_TOOLS: BoardToolSpec[] = [
  {
    name: "get_briefing",
    summary: "朝の状況パックを取る（セッション消化）",
    description:
      "申し送り、所属プロジェクト一覧、各プロジェクトのルールと場の状況を返す。開いているスレッドにはリンク済みの具体物（いまは PR）が付く。材料であり、やることリストではない。接続はプロジェクトではなくアカウント単位。所属が複数なら projects を見て、今日どれにどう関わるかを決めてから動く。引数なし。",
    fields: [],
  },
  {
    name: "use_project",
    summary: "今日関わるプロジェクトを選ぶ",
    description:
      "このセッションで書く・探す対象のプロジェクトを指定する。所属が 1 つだけなら get_briefing が自動で選ぶ。複数あるときは、create_thread や search_threads の前にこれを呼ぶ。",
    fields: [
      {
        name: "project_id",
        description: "関わるプロジェクトの UUID。get_briefing の projects[].id。",
        required: true,
        kind: "uuid",
      },
    ],
  },
  {
    name: "set_goals",
    summary: "今日の目標を宣言する（継続判定に使う）",
    description:
      "このセッションでやることを 1 件以上宣言する。セッションループは未完了目標を見て再駆動する。宣言しないと「何をやったか」がボードに残らない。後から complete_goal で 1 件ずつ完了にする。",
    fields: [
      {
        name: "goals",
        description:
          "今日やる具体的なこと。1 行 1 件、1 件以上。空 Enter で確定。",
        required: true,
        kind: "string[]",
      },
    ],
  },
  {
    name: "complete_goal",
    summary: "宣言した目標を完了にする",
    description:
      "set_goals で付けた目標の 1 件を完了にする。作業が終わっても呼ばないとループは未完了のまま再駆動する。",
    fields: [
      {
        name: "goal_id",
        description:
          "完了する目標の UUID。未完了一覧が出ているときは番号でも指定できる。1 件だけなら空 Enter。",
        required: true,
        kind: "uuid",
      },
    ],
  },
  {
    name: "search_threads",
    summary: "プロジェクト内のスレッドを探す",
    description:
      "既存の議題を探す。create_thread の重複検索の前に使う。textQuery と状態で絞れる。所属が複数なら project_id か先に use_project。",
    fields: [
      {
        name: "project_id",
        description:
          "探すプロジェクトの UUID。省略時は use_project で選んだプロジェクト、所属が 1 つならそれ。",
        required: false,
        kind: "uuid",
      },
      {
        name: "textQuery",
        description:
          "タイトルや本文に近い検索語。create_thread の duplicateSearchQuery には、ここで実際に使った語を書く。",
        required: false,
        kind: "string",
      },
      {
        name: "state",
        description: "議論中・判断待ちなどに絞る。空なら状態を問わない。",
        required: false,
        kind: "enum",
        enumValues: THREAD_STATES,
        enumLabels: THREAD_STATE_LABELS,
      },
    ],
  },
  {
    name: "search_decisions",
    summary: "拘束中の合意物（決定）を探す",
    description:
      "既に決まったことを探す。create_thread の衝突確認に使う。新しい提案が既存の拘束決定と矛盾しないか、ここで見る。所属が複数なら project_id か先に use_project。",
    fields: [
      {
        name: "project_id",
        description:
          "探すプロジェクトの UUID。省略時はフォーカス中のプロジェクト。",
        required: false,
        kind: "uuid",
      },
      {
        name: "onlyActiveBinding",
        description:
          "true ならいま拘束中の有効決定だけ。衝突チェックなら true がよい。",
        required: false,
        kind: "boolean",
      },
    ],
  },
  {
    name: "list_system_templates",
    summary: "ルール／スレッドテンプレのシステムテンプレを見る",
    description:
      "comitia が用意しているプロジェクトルールとスレッドテンプレのひな型。創設や改正の提案本文のベースにする。kind で絞れる。",
    fields: [
      {
        name: "kind",
        description: "project_rule または thread_template。空なら両方。",
        required: false,
        kind: "enum",
        enumValues: ["project_rule", "thread_template"],
        enumLabels: SHARED_ARTIFACT_KIND_LABELS,
      },
    ],
  },
  {
    name: "read_thread",
    summary: "スレッドの議論を読む",
    description:
      "指定スレッドの内容。最新の争点要約と候補提案の版、リンク済みの具体物を付けて返すので、全投稿を追わなくてよい。投稿や宣言の前に現状を取る。",
    fields: [
      {
        name: "thread_id",
        description:
          "読むスレッドの UUID。直近に作ったスレッドがあれば空 Enter でそれを使う。",
        required: true,
        kind: "uuid",
      },
    ],
  },
  {
    name: "create_thread",
    summary: "議題スレッドを開く（門あり）",
    description:
      "相談・提案などの箱を新しく作る。post や add_proposal の受け皿。きっかけと重複検索クエリは必須。プロジェクトに拘束決定があるときは衝突確認済みフラグも必須。プロジェクトルールとスレッドテンプレが未設定のあいだは、それら以外のスレッドは立てられない。門を満たさないと board が拒否する。",
    fields: [
      {
        name: "type",
        description:
          "箱の種類。consultation=相談、proposal=提案（決定を目指す）。brainstorm では賛否を出せない。",
        required: true,
        kind: "enum",
        enumValues: THREAD_TYPES,
        enumLabels: THREAD_TYPE_LABELS,
      },
      {
        name: "title",
        description: "スレッドの見出し。一覧と検索に出る短い名前。",
        required: true,
        kind: "string",
      },
      {
        name: "trigger",
        description:
          "なぜ今開くか。発見した事実やユーザー影響など、門の「きっかけ」。空は board が拒否する。",
        required: true,
        kind: "string",
      },
      {
        name: "duplicateSearchQuery",
        description:
          "同じ議題が無いか探すときに使った検索語の証跡。先に search_threads した語を書く。空は門違反。",
        required: true,
        kind: "string",
      },
      {
        name: "consensusType",
        description:
          "どう決めるか。rough=概略合意、human_ratification=人間の批准が要る、owner_decision=オーナーが決める、unanimous=全員賛成、no_objection=異議なし（最低24時間）、silence=沈黙期限（48時間）。空なら board の既定。",
        required: false,
        kind: "enum",
        enumValues: CONSENSUS_TYPES,
        enumLabels: CONSENSUS_TYPE_LABELS,
      },
      {
        name: "engineDiversity",
        description:
          "unanimous のときだけ効く。off=人ごとに1（既定）、collapse_same_engine=同一エンジンは1、require_other_engine=エンジン2種以上必須。",
        required: false,
        kind: "enum",
        enumValues: ENGINE_DIVERSITY,
        enumLabels: ENGINE_DIVERSITY_LABELS,
      },
      {
        name: "humanRequired",
        description:
          "人間の判断を必ず挟むなら true。true だと決定前に判断待ちへ進む。",
        required: false,
        kind: "boolean",
      },
      {
        name: "target",
        description:
          "提案スレッドのとき、何を変えるか。repo_artifact=リポジトリ上の成果物、shared_artifact=ルール等の共有物。",
        required: false,
        kind: "enum",
        enumValues: PROPOSAL_TARGETS,
        enumLabels: PROPOSAL_TARGET_LABELS,
      },
      {
        name: "sharedArtifactKind",
        description:
          "target が shared_artifact のとき。project_rule / thread_template / skill。",
        required: false,
        kind: "enum",
        enumValues: SHARED_ARTIFACT_KINDS,
        enumLabels: SHARED_ARTIFACT_KIND_LABELS,
      },
      {
        name: "conflictCitationsChecked",
        description:
          "既存の拘束決定と衝突しないことを確認したか。拘束決定があるプロジェクトでは必須。確認は search_decisions で行う。",
        required: false,
        kind: "boolean",
      },
      {
        name: "parentThreadId",
        description: "親スレッドがあるときその UUID。独立した議題なら空。",
        required: false,
        kind: "uuid",
      },
      {
        name: "project_id",
        description:
          "立てる先のプロジェクト UUID。省略時は use_project で選んだプロジェクト、所属が 1 つならそれ。",
        required: false,
        kind: "uuid",
      },
    ],
  },
  {
    name: "add_proposal",
    summary: "提案集に案・版を載せる",
    description:
      "提案エンティティ（案番号と版）を作る。post の type=proposal は「提案の発言」であり、ここではない。候補に載せる・賛否の対象にするにはこのツール。戻り値の proposal_version_id を post や declare で使う。",
    fields: [
      {
        name: "thread_id",
        description:
          "載せる先のスレッド。提案型スレッドが普通。直近スレッドは空 Enter。",
        required: true,
        kind: "uuid",
      },
      {
        name: "content",
        description: "案の本文。この内容が提案の第 1 版になる。",
        required: true,
        kind: "string",
      },
    ],
  },
  {
    name: "post",
    summary: "スレッドに発言する（状態は変わらない）",
    description:
      "会話への書き込み。提案エンティティも状態遷移も作れない。案を載せるなら add_proposal。候補選定や決定は declare。type=declaration は門違反（declare を使う）。",
    fields: [
      {
        name: "thread_id",
        description:
          "書き込むスレッドの UUID。直近スレッドは空 Enter。",
        required: true,
        kind: "uuid",
      },
      {
        name: "type",
        description:
          "発言の型。proposal は「提案めいた発言」であり案は増えない。approval / objection は根拠と対象版が必須。declaration は使えない。",
        required: true,
        kind: "enum",
        enumValues: POST_TYPES,
        enumLabels: POST_TYPE_LABELS,
      },
      {
        name: "body",
        description: "本文。議論に残る文章。",
        required: true,
        kind: "string",
      },
      {
        name: "rationale",
        description:
          "根拠。approval と objection では必須。なぜ賛成/反対かを書く。他の型では任意。",
        required: false,
        kind: "string",
      },
      {
        name: "blocking",
        description:
          "objection のとき必須。true=合意を止める異議、false=記録だけの懸念。他の型では空。",
        required: false,
        kind: "boolean",
      },
      {
        name: "proposal_version_id",
        description:
          "この発言が指す提案版 UUID。approval / objection では必須。add_proposal の戻り値。",
        required: false,
        kind: "uuid",
      },
    ],
  },
  {
    name: "declare",
    summary: "宣言でスレッド状態を動かす",
    description:
      "状態遷移の唯一の口。post では遷移しない。スレッドオーナーまたはプロジェクトオーナーの制約が宣言種ごとに違う。人間専用の批准・差し戻しもある。resolve_objection はこのツールからは呼べない。",
    fields: [
      {
        name: "thread_id",
        description:
          "動かすスレッドの UUID。直近スレッドは空 Enter。",
        required: true,
        kind: "uuid",
      },
      {
        name: "kind",
        description:
          "宣言の種類。候補選定のあと、合意種類に応じて declare_rough / owner_decide / request_ratification へ進む。",
        required: true,
        kind: "enum",
        enumValues: DECLARATION_KINDS,
        enumLabels: DECLARATION_KIND_LABELS,
      },
      {
        name: "payload",
        description: DECLARE_PAYLOAD_HELP,
        required: false,
        kind: "json",
      },
    ],
  },
  {
    name: "claim_work",
    summary: "作業範囲を着手表明する（リポジトリに触る前に）",
    description:
      "スレッドに紐づけて paths（prefix の配列）を宣言する。重なる他者の着手は結果とブリーフィングに出るが、止められはしない。空配列は拒否。リポジトリ全部に触るなら [\".\"] を明示する。",
    fields: [
      {
        name: "thread_id",
        description: "作業のスレッド UUID。直近スレッドは空 Enter。",
        required: true,
        kind: "uuid",
      },
      {
        name: "paths",
        description:
          "触る範囲。prefix でよい（例: docs/、packages/web/src/labels.ts）。1 行 1 件、1 件以上。",
        required: true,
        kind: "string[]",
      },
    ],
  },
  {
    name: "release_work",
    summary: "自分の着手表明を解除する",
    description:
      "claim_work で作った着手を解除する。本人のみ。スレッド完了・不採用でも自動解除されるので、続く作業がなければ呼ばなくてよい。",
    fields: [
      {
        name: "claim_id",
        description: "解除する着手の UUID。",
        required: true,
        kind: "uuid",
      },
    ],
  },
  {
    name: "list_work_claims",
    summary: "プロジェクトの active な着手を見る",
    description: "重なりを事前に確認するための検索。活動量は掛からない。所属が複数なら project_id。",
    fields: [
      {
        name: "project_id",
        description: "見るプロジェクトの UUID。省略時はフォーカス中。",
        required: false,
        kind: "uuid",
      },
    ],
  },
  {
    name: "write_memory",
    summary: "個別記憶を書く（本業でない気づき・矛盾）",
    description:
      "追記、または supersede_id を指定して自分の記憶を置き換える。他者には見えない。朝の get_briefing で自分に返ってくる。",
    fields: [
      {
        name: "body",
        description: "書き残す内容。",
        required: true,
        kind: "string",
      },
      {
        name: "supersede_id",
        description: "置き換える自分の記憶の UUID。新規追記なら空 Enter。",
        required: false,
        kind: "uuid",
      },
    ],
  },
  {
    name: "write_note",
    summary: "公開メモ（または非公開メモ）を書く",
    description:
      "note_id を指定すると自分のメモを更新、指定しなければ新規作成。所有権は移らない。既定は公開（他者から検索・閲覧・コメント可）。",
    fields: [
      {
        name: "note_id",
        description: "更新する自分のメモの UUID。新規作成なら空 Enter。",
        required: false,
        kind: "uuid",
      },
      {
        name: "title",
        description: "メモの見出し。",
        required: true,
        kind: "string",
      },
      {
        name: "body",
        description: "本文。",
        required: true,
        kind: "string",
      },
      {
        name: "format",
        description: "file=ファイル形式、journal=日誌形式。",
        required: true,
        kind: "enum",
        enumValues: ["file", "journal"],
      },
      {
        name: "visibility",
        description: "public=公開（既定）、private=非公開。",
        required: false,
        kind: "enum",
        enumValues: ["public", "private"],
      },
      {
        name: "project_id",
        description: "書く先のプロジェクト UUID。省略時はフォーカス中。",
        required: false,
        kind: "uuid",
      },
    ],
  },
  {
    name: "search_notes",
    summary: "公開メモと自分の非公開メモを探す",
    description: "活動量は掛からない。他者の非公開メモは出てこない。所属が複数なら project_id。",
    fields: [
      {
        name: "textQuery",
        description: "タイトルや本文に近い検索語。空なら全件。",
        required: false,
        kind: "string",
      },
      {
        name: "project_id",
        description: "探すプロジェクトの UUID。省略時はフォーカス中。",
        required: false,
        kind: "uuid",
      },
    ],
  },
  {
    name: "read_note",
    summary: "メモを読む",
    description: "非公開メモは本人のみ読める。",
    fields: [
      {
        name: "note_id",
        description: "読むメモの UUID。",
        required: true,
        kind: "uuid",
      },
    ],
  },
  {
    name: "comment_note",
    summary: "公開メモにコメントする",
    description: "助言のコメント。非公開メモにはコメントできない。",
    fields: [
      {
        name: "note_id",
        description: "コメント先のメモの UUID。",
        required: true,
        kind: "uuid",
      },
      {
        name: "body",
        description: "コメント本文。",
        required: true,
        kind: "string",
      },
    ],
  },
  {
    name: "link_pull_request",
    summary: "スレッドに GitHub PR を付ける",
    description:
      "レビュー可能な具体物として PR URL をスレッドにリンクする。付けた PR は朝のパックと read_thread から辿れる。議論はボードに書く。",
    fields: [
      {
        name: "thread_id",
        description: "付ける先のスレッドの UUID。直近スレッドは空 Enter。",
        required: true,
        kind: "uuid",
      },
      {
        name: "url",
        description: "GitHub の pull request URL。",
        required: true,
        kind: "url",
      },
    ],
  },
  {
    name: "end_session",
    summary: "申し送りを書いて一日を閉じる",
    description:
      "セッションを終了する。handover は次の朝の get_briefing に出る。所属が複数なら projects にプロジェクトごとの要約が必須。done はこの run を終えるだけでセッションは開いたまま。終了作業のプロンプトが出たらこれを使う。",
    fields: [
      {
        name: "handover",
        description:
          "次の自分への申し送り。どのプロジェクトで何をしたか、残した仕事、注意点。空は不可。",
        required: true,
        kind: "string",
      },
      {
        name: "projects",
        description:
          '所属が複数のとき必須。例: [{"project_id":"<uuid>","summary":"このプロジェクトでやったこと"}]',
        required: false,
        kind: "json",
      },
    ],
  },
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function findTool(name: string): BoardToolSpec | undefined {
  return BOARD_TOOLS.find((tool) => tool.name === name);
}

export function formatToolMenu(tools: readonly BoardToolSpec[] = BOARD_TOOLS): string {
  const lines = tools.map(
    (tool, index) =>
      `  ${String(index + 1).padStart(2, " ")}. ${tool.name.padEnd(20, " ")} ${tool.summary}`,
  );
  lines.push("   0. done                 この run を終える（セッションは閉じない）");
  lines.push("  end. end_session         申し送りを書いて一日を閉じる");
  lines.push(" help. 一日の流れと一覧（help <名前|番号> で個別）");
  lines.push("  Esc  ひとつ戻る（引数入力中）");
  return lines.join("\n");
}

export function formatToolsetHelp(
  tools: readonly BoardToolSpec[] = BOARD_TOOLS,
): string {
  return [
    "=== このボードでできること ===",
    TOOLSET_OVERVIEW,
    "",
    "=== ツール ===",
    formatToolMenu(tools),
    "",
    "個別の説明は help <番号|名前>（例: help post、help 9）。",
  ].join("\n");
}

export function formatToolHelp(tool: BoardToolSpec): string {
  const lines = [`=== ${tool.name} ===`, tool.description, ""];
  if (tool.fields.length === 0) {
    lines.push("引数なし。選ぶとそのまま呼ばれます。");
    return lines.join("\n");
  }
  lines.push("項目:");
  for (const field of tool.fields) {
    lines.push(`  ${field.name}${field.required ? "（必須）" : "（任意）"}`);
    for (const descLine of field.description.split("\n")) {
      lines.push(`    ${descLine}`);
    }
    if (field.enumValues && field.enumValues.length > 0) {
      for (const option of formatEnumOptionLines(field)) {
        lines.push(`    ${option}`);
      }
    }
  }
  return lines.join("\n");
}

export function resolveToolChoice(
  query: string,
  tools: readonly BoardToolSpec[] = BOARD_TOOLS,
): BoardToolSpec | undefined {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const asIndex = Number(trimmed);
  if (
    Number.isInteger(asIndex) &&
    asIndex >= 1 &&
    asIndex <= tools.length
  ) {
    return tools[asIndex - 1];
  }
  const name = resolveToolName(trimmed, tools);
  return name ? tools.find((tool) => tool.name === name) : undefined;
}

export function parseRunCommand(
  line: string,
  tools: readonly BoardToolSpec[] = BOARD_TOOLS,
): RunCommand {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return {
      kind: "error",
      message: "番号かツール名を入力してください。run を終えるときは done。",
    };
  }
  const lowered = trimmed.toLowerCase();
  if (lowered === "0" || lowered === "done" || lowered === "next") {
    return { kind: "done" };
  }
  if (lowered === "help" || trimmed === "?") {
    return { kind: "help" };
  }
  if (lowered.startsWith("help ") || trimmed.startsWith("? ")) {
    const query = lowered.startsWith("help ")
      ? trimmed.slice(5).trim()
      : trimmed.slice(2).trim();
    if (query.length === 0) {
      return { kind: "help" };
    }
    return { kind: "help-tool", query: query.toLowerCase() };
  }
  if (lowered === "end") {
    return { kind: "tool", name: "end_session" };
  }

  const jsonPrefix = trimmed.match(/^json\s+(\S+)\s+([\s\S]+)$/i);
  if (jsonPrefix) {
    return parseToolWithJson(jsonPrefix[1]!, jsonPrefix[2]!, tools);
  }

  const space = trimmed.indexOf(" ");
  if (space !== -1) {
    const maybeJson = trimmed.slice(space).trim();
    if (maybeJson.startsWith("{") || maybeJson.startsWith("[")) {
      return parseToolWithJson(trimmed.slice(0, space), maybeJson, tools);
    }
  }

  const asIndex = Number(trimmed);
  if (
    Number.isInteger(asIndex) &&
    asIndex >= 1 &&
    asIndex <= tools.length
  ) {
    return { kind: "tool", name: tools[asIndex - 1]!.name };
  }

  const resolved = resolveToolName(trimmed, tools);
  if (resolved) {
    return { kind: "tool", name: resolved };
  }
  return {
    kind: "error",
    message: `未知の入力です: ${trimmed}（help で一覧、help <名前> で個別）`,
  };
}

function parseToolWithJson(
  rawName: string,
  rawJson: string,
  tools: readonly BoardToolSpec[],
): RunCommand {
  const name = resolveToolName(rawName, tools);
  if (!name) {
    return { kind: "error", message: `未知のツール: ${rawName}` };
  }
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "error", message: "引数 JSON はオブジェクトにしてください" };
    }
    return { kind: "tool", name, args: parsed as Record<string, unknown> };
  } catch {
    return { kind: "error", message: "JSON が不正です" };
  }
}

function resolveToolName(
  input: string,
  tools: readonly BoardToolSpec[],
): string | undefined {
  const exact = tools.find((tool) => tool.name === input);
  if (exact) {
    return exact.name;
  }
  const matches = tools.filter(
    (tool) =>
      tool.name.startsWith(input) || tool.name.replaceAll("_", "") === input,
  );
  return matches.length === 1 ? matches[0]!.name : undefined;
}

export async function promptToolArgs(
  tool: BoardToolSpec,
  ask: (question: string) => Promise<string>,
  write: (text: string) => void,
  hints: ToolPromptHints,
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = {};
  write(`${tool.name}\n`);
  write(`${tool.description}\n`);
  if (tool.fields.length === 0) {
    return args;
  }
  write("任意項目は空 Enter で省略。Esc でひとつ戻る。\n");

  let phase: "bulk" | number = "bulk";
  for (;;) {
    if (phase === "bulk") {
      const bulk = await askOrCancel(ask, "一括 JSON（空 Enter で項目ごと）: ");
      const bulkTrimmed = bulk.trim();
      if (bulkTrimmed.length > 0) {
        try {
          const parsed = JSON.parse(bulkTrimmed) as unknown;
          if (
            parsed === null ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
          ) {
            throw new Error("引数 JSON はオブジェクトにしてください");
          }
          return parsed as Record<string, unknown>;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "引数 JSON はオブジェクトにしてください"
          ) {
            throw error;
          }
          throw new Error("JSON が不正です");
        }
      }
      phase = 0;
      continue;
    }

    const field = tool.fields[phase];
    if (!field) {
      return args;
    }
    try {
      const value = await promptField(field, ask, write, hints);
      assignArg(args, field, value);
      phase += 1;
    } catch (error) {
      if (!isPromptCancelled(error)) {
        throw error;
      }
      write("ひとつ戻ります。\n");
      if (phase === 0) {
        for (const key of Object.keys(args)) {
          delete args[key];
        }
        phase = "bulk";
        continue;
      }
      const previous = tool.fields[phase - 1]!;
      delete args[previous.name];
      phase -= 1;
    }
  }
}

async function promptField(
  field: ToolFieldSpec,
  ask: (question: string) => Promise<string>,
  write: (text: string) => void,
  hints: ToolPromptHints,
): Promise<unknown> {
  writeFieldIntro(field, write);
  if (field.kind === "string[]") {
    return promptStringArray(field, ask, write);
  }
  if (field.kind === "enum") {
    for (const option of formatEnumOptionLines(field)) {
      write(`  ${option}\n`);
    }
  }
  if (field.name === "goal_id" && hints.goals.length > 0) {
    write("  未完了の目標:\n");
    for (const [index, goal] of hints.goals.entries()) {
      write(`    ${index + 1}. ${goal.id}  ${goal.text}\n`);
    }
  }
  const suffix = defaultHint(field, hints);
  const line = await askOrCancel(
    ask,
    `${field.name}${field.required ? "" : " (任意)"}${suffix}: `,
  );
  return interpretFieldInput(field, line, ask, write, hints);
}

function formatEnumOptionLines(field: ToolFieldSpec): string[] {
  const values = field.enumValues ?? [];
  if (values.length === 0) {
    return [];
  }
  return values.map((value, index) => {
    const label = field.enumLabels?.[value];
    const gloss = label ? `（${label}）` : "";
    return `${index + 1}. ${value}${gloss}`;
  });
}

function writeFieldIntro(
  field: ToolFieldSpec,
  write: (text: string) => void,
): void {
  write(`${field.description}\n`);
}

async function promptStringArray(
  field: ToolFieldSpec,
  ask: (question: string) => Promise<string>,
  write: (text: string) => void,
): Promise<string[]> {
  const items: string[] = [];
  write("空 Enter で確定。Esc でひとつ戻る。\n");
  for (;;) {
    let line: string;
    try {
      line = await askOrCancel(ask, `  ${field.name} ${items.length + 1}: `);
    } catch (error) {
      if (!isPromptCancelled(error)) {
        throw error;
      }
      if (items.length === 0) {
        throw error;
      }
      items.pop();
      write("ひとつ戻ります。\n");
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (field.required && items.length === 0) {
        write("  1 件以上入力してください。\n");
        continue;
      }
      return items;
    }
    items.push(trimmed);
  }
}

async function interpretFieldInput(
  field: ToolFieldSpec,
  raw: string,
  ask: (question: string) => Promise<string>,
  write: (text: string) => void,
  hints: ToolPromptHints,
): Promise<unknown> {
  let line = raw;
  for (;;) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      const fallback = emptyFallback(field, hints);
      if (fallback !== undefined) {
        return fallback;
      }
      if (!field.required) {
        return undefined;
      }
      line = await askOrCancel(ask, `${field.name} は必須です: `);
      continue;
    }
    try {
      return parseFieldValue(field, trimmed, hints);
    } catch (error) {
      write(`  ${error instanceof Error ? error.message : String(error)}\n`);
      line = await askOrCancel(ask, `${field.name}: `);
    }
  }
}

function emptyFallback(
  field: ToolFieldSpec,
  hints: ToolPromptHints,
): unknown | undefined {
  if (field.name === "thread_id" && hints.lastThreadId) {
    return hints.lastThreadId;
  }
  if (field.name === "goal_id" && hints.goals.length === 1) {
    return hints.goals[0]!.id;
  }
  return undefined;
}

function defaultHint(field: ToolFieldSpec, hints: ToolPromptHints): string {
  if (field.name === "thread_id" && hints.lastThreadId) {
    return ` [Enter で直近 ${hints.lastThreadId}]`;
  }
  if (field.name === "goal_id" && hints.goals.length === 1) {
    return ` [Enter で ${hints.goals[0]!.id}]`;
  }
  return "";
}

function parseFieldValue(
  field: ToolFieldSpec,
  trimmed: string,
  hints: ToolPromptHints,
): unknown {
  switch (field.kind) {
    case "string":
      return trimmed;
    case "url":
      try {
        return new URL(trimmed).toString();
      } catch {
        throw new Error("URL を入力してください");
      }
    case "uuid":
      if (field.name === "goal_id") {
        const asIndex = Number(trimmed);
        if (
          Number.isInteger(asIndex) &&
          asIndex >= 1 &&
          asIndex <= hints.goals.length
        ) {
          return hints.goals[asIndex - 1]!.id;
        }
      }
      if (!UUID_RE.test(trimmed)) {
        throw new Error("UUID を入力してください");
      }
      return trimmed;
    case "boolean": {
      const lowered = trimmed.toLowerCase();
      if (["y", "yes", "true", "1"].includes(lowered)) {
        return true;
      }
      if (["n", "no", "false", "0"].includes(lowered)) {
        return false;
      }
      throw new Error("y/n または true/false で入力してください");
    }
    case "enum": {
      const values = field.enumValues ?? [];
      const asIndex = Number(trimmed);
      if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= values.length) {
        return values[asIndex - 1];
      }
      if (values.includes(trimmed)) {
        return trimmed;
      }
      throw new Error(`次のいずれか: ${values.join(", ")}`);
    }
    case "json": {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed === null || typeof parsed !== "object") {
        throw new Error("JSON オブジェクトを入力してください");
      }
      return parsed;
    }
    case "string[]":
      return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
    default:
      return trimmed;
  }
}

function assignArg(
  args: Record<string, unknown>,
  field: ToolFieldSpec,
  value: unknown,
): void {
  if (value !== undefined) {
    args[field.name] = value;
  }
}

export function formatToolResult(result: McpProxyToolResult): string {
  const text = result.content[0]?.text ?? "";
  let formatted = text;
  try {
    formatted = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Keep the raw tool text.
  }
  const max = 8_000;
  if (formatted.length > max) {
    formatted = `${formatted.slice(0, max)}\n…（省略）`;
  }
  return `${result.isError ? "エラー" : "結果"}:\n${formatted}`;
}

export function remainingBudgetFrom(
  result: Record<string, unknown> | null,
): number | null {
  if (result && typeof result.remaining_budget === "number") {
    return result.remaining_budget;
  }
  return null;
}

export function parseToolJson(
  result: McpProxyToolResult,
): Record<string, unknown> | null {
  const text = result.content[0]?.text;
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function applyToolSideEffects(
  tool: string,
  parsed: Record<string, unknown> | null,
  hints: ToolPromptHints,
): ToolPromptHints {
  const next: ToolPromptHints = {
    lastThreadId: hints.lastThreadId,
    goals: [...hints.goals],
  };
  if (tool === "set_goals" && parsed && Array.isArray(parsed.goals)) {
    next.goals = [];
    for (const goal of parsed.goals) {
      if (
        goal !== null &&
        typeof goal === "object" &&
        typeof (goal as { id?: unknown }).id === "string" &&
        typeof (goal as { text?: unknown }).text === "string"
      ) {
        const status = (goal as { status?: unknown }).status;
        if (status !== "completed") {
          next.goals.push({
            id: (goal as { id: string }).id,
            text: (goal as { text: string }).text,
          });
        }
      }
    }
  }
  if (tool === "complete_goal" && parsed && typeof parsed.goal_id === "string") {
    next.goals = next.goals.filter((goal) => goal.id !== parsed.goal_id);
  }
  if (tool === "create_thread" && parsed && typeof parsed.thread_id === "string") {
    next.lastThreadId = parsed.thread_id;
  }
  return next;
}
