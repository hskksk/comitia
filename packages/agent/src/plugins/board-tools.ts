import {
  CONSENSUS_TYPES,
  DECLARATION_KINDS,
  POST_TYPES,
  PROPOSAL_TARGETS,
  SHARED_ARTIFACT_KINDS,
  THREAD_STATES,
  THREAD_TYPES,
} from "@comitia/shared";
import { MCP_PROXY_TOOLS, type McpProxyToolResult } from "../mcp-proxy.js";

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
}

export interface BoardToolSpec {
  name: (typeof MCP_PROXY_TOOLS)[number];
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
    description: "コンテキストパック（申し送り・ルール・状況）を取得する",
    fields: [],
  },
  {
    name: "set_goals",
    description: "その日の目標を宣言する",
    fields: [
      {
        name: "goals",
        description: "今日の目標（1 件以上）",
        required: true,
        kind: "string[]",
      },
    ],
  },
  {
    name: "complete_goal",
    description: "宣言済み目標を完了にする",
    fields: [
      {
        name: "goal_id",
        description: "完了する目標の id",
        required: true,
        kind: "uuid",
      },
    ],
  },
  {
    name: "search_threads",
    description: "プロジェクト内のスレッドを検索する",
    fields: [
      {
        name: "textQuery",
        description: "検索語",
        required: false,
        kind: "string",
      },
      {
        name: "state",
        description: "スレッド状態",
        required: false,
        kind: "enum",
        enumValues: THREAD_STATES,
      },
    ],
  },
  {
    name: "search_decisions",
    description: "合意物（決定）を検索する",
    fields: [
      {
        name: "onlyActiveBinding",
        description: "拘束中の有効決定だけ",
        required: false,
        kind: "boolean",
      },
    ],
  },
  {
    name: "read_thread",
    description: "スレッド内容を読む",
    fields: [
      {
        name: "thread_id",
        description: "スレッド id",
        required: true,
        kind: "uuid",
      },
    ],
  },
  {
    name: "create_thread",
    description: "新しいスレッドを作成する（門: きっかけ・重複検索）",
    fields: [
      {
        name: "type",
        description: "スレッド型",
        required: true,
        kind: "enum",
        enumValues: THREAD_TYPES,
      },
      {
        name: "title",
        description: "タイトル",
        required: true,
        kind: "string",
      },
      {
        name: "trigger",
        description: "きっかけ",
        required: true,
        kind: "string",
      },
      {
        name: "duplicateSearchQuery",
        description: "重複検索クエリ",
        required: true,
        kind: "string",
      },
      {
        name: "consensusType",
        description: "合意種類",
        required: false,
        kind: "enum",
        enumValues: CONSENSUS_TYPES,
      },
      {
        name: "humanRequired",
        description: "人間の判断が必要",
        required: false,
        kind: "boolean",
      },
      {
        name: "target",
        description: "提案の対象",
        required: false,
        kind: "enum",
        enumValues: PROPOSAL_TARGETS,
      },
      {
        name: "sharedArtifactKind",
        description: "共有物の種類",
        required: false,
        kind: "enum",
        enumValues: SHARED_ARTIFACT_KINDS,
      },
      {
        name: "conflictCitationsChecked",
        description: "既存決定との衝突を確認済み",
        required: false,
        kind: "boolean",
      },
      {
        name: "parentThreadId",
        description: "親スレッド id",
        required: false,
        kind: "uuid",
      },
    ],
  },
  {
    name: "add_proposal",
    description: "スレッドに提案エンティティを追加する",
    fields: [
      {
        name: "thread_id",
        description: "スレッド id",
        required: true,
        kind: "uuid",
      },
      {
        name: "content",
        description: "提案本文",
        required: true,
        kind: "string",
      },
    ],
  },
  {
    name: "post",
    description: "スレッドに投稿する",
    fields: [
      {
        name: "thread_id",
        description: "スレッド id",
        required: true,
        kind: "uuid",
      },
      {
        name: "type",
        description: "投稿型",
        required: true,
        kind: "enum",
        enumValues: POST_TYPES,
      },
      {
        name: "body",
        description: "本文",
        required: true,
        kind: "string",
      },
      {
        name: "rationale",
        description: "根拠（approval / objection は必須）",
        required: false,
        kind: "string",
      },
      {
        name: "blocking",
        description: "ブロッキング異議",
        required: false,
        kind: "boolean",
      },
      {
        name: "proposal_version_id",
        description: "対象の提案版 id",
        required: false,
        kind: "uuid",
      },
    ],
  },
  {
    name: "declare",
    description: "宣言による状態遷移を行う",
    fields: [
      {
        name: "thread_id",
        description: "スレッド id",
        required: true,
        kind: "uuid",
      },
      {
        name: "kind",
        description: "宣言の種類",
        required: true,
        kind: "enum",
        enumValues: DECLARATION_KINDS,
      },
      {
        name: "payload",
        description: "追加ペイロード",
        required: false,
        kind: "json",
      },
    ],
  },
  {
    name: "link_pull_request",
    description: "スレッドに GitHub PR をリンクする",
    fields: [
      {
        name: "thread_id",
        description: "スレッド id",
        required: true,
        kind: "uuid",
      },
      {
        name: "url",
        description: "PR URL",
        required: true,
        kind: "url",
      },
    ],
  },
  {
    name: "end_session",
    description: "セッションを終了する（申し送り必須）",
    fields: [
      {
        name: "handover",
        description: "申し送り",
        required: true,
        kind: "string",
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
      `  ${String(index + 1).padStart(2, " ")}. ${tool.name.padEnd(20, " ")} ${tool.description}`,
  );
  lines.push("   0. done                 この run を終える");
  lines.push("  end. end_session         申し送りを書いて一日を閉じる");
  lines.push(" help. この一覧を再表示");
  lines.push("  Esc  ひとつ戻る（引数入力中）");
  return lines.join("\n");
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
    message: `未知の入力です: ${trimmed}（help で一覧）`,
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
  if (tool.fields.length === 0) {
    return args;
  }
  write(`${tool.name}: ${tool.description}\n`);
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
    write(
      `  候補: ${(field.enumValues ?? []).map((value, index) => `${index + 1}=${value}`).join("  ")}\n`,
    );
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
