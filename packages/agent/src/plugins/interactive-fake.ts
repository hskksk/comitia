import * as readline from "node:readline";
import * as readlinePromises from "node:readline/promises";
import type { McpProxyToolResult } from "../mcp-proxy.js";
import {
  applyToolSideEffects,
  findTool,
  formatToolHelp,
  formatToolMenu,
  formatToolResult,
  formatToolsetHelp,
  isEscapeLine,
  isPromptCancelled,
  parseRunCommand,
  parseToolJson,
  promptToolArgs,
  resolveToolChoice,
  remainingBudgetFrom,
  ESCAPE_LINE,
  type ToolPromptHints,
} from "./board-tools.js";
import type { EnginePlugin, EngineRunContext } from "./types.js";
import { toolLogToTraceEvents } from "../trace-format.js";

export interface InteractiveIo {
  write: (text: string) => void;
  ask: (question: string) => Promise<string>;
  close?: () => void;
}

export interface InteractiveFakeEngineOptions {
  callTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<McpProxyToolResult>;
  io?: InteractiveIo;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  onInterrupt?: () => void;
}

function isTtyInput(
  stream: NodeJS.ReadableStream,
): stream is NodeJS.ReadStream {
  return "isTTY" in stream && "setRawMode" in stream && stream.isTTY === true;
}

function eraseLastChar(stdout: NodeJS.WritableStream): void {
  stdout.write("\b \b");
}

/** Read a line; Escape resolves as ESCAPE_LINE without waiting for Enter. */
export function askOnTty(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WritableStream,
  question: string,
  onInterrupt?: () => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(question);
    let buf = "";
    const wasRaw = stdin.isRaw === true;
    if (!wasRaw) {
      stdin.setRawMode(true);
    }
    if (stdin.isPaused()) {
      stdin.resume();
    }

    const onKeypress = (str: string | undefined, key: readline.Key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        stdout.write("\n");
        onInterrupt?.();
        reject(new Error("interrupted"));
        return;
      }
      if (key.name === "escape") {
        cleanup();
        stdout.write("\n");
        resolve(ESCAPE_LINE);
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        stdout.write("\n");
        resolve(buf);
        return;
      }
      if (key.name === "backspace" || key.name === "delete") {
        const chars = [...buf];
        if (chars.length > 0) {
          chars.pop();
          buf = chars.join("");
          eraseLastChar(stdout);
        }
        return;
      }
      if (!str || key.ctrl || key.meta || str === ESCAPE_LINE) {
        return;
      }
      buf += str;
      stdout.write(str);
    };

    function cleanup() {
      stdin.off("keypress", onKeypress);
      if (!wasRaw && stdin.isRaw) {
        stdin.setRawMode(false);
      }
    }

    stdin.on("keypress", onKeypress);
  });
}

export function createReadlineIo(options: {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  onInterrupt?: () => void;
}): InteractiveIo {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const tty = isTtyInput(stdin);

  if (tty) {
    readline.emitKeypressEvents(stdin);
    return {
      write(text) {
        stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      },
      ask(question) {
        return askOnTty(stdin, stdout, question, options.onInterrupt);
      },
      close() {
        if (stdin.isRaw) {
          stdin.setRawMode(false);
        }
      },
    };
  }

  const rl = readlinePromises.createInterface({ input: stdin, output: stdout });
  rl.on("SIGINT", () => {
    stdout.write("\n切断します。\n");
    rl.close();
    options.onInterrupt?.();
  });
  return {
    write(text) {
      stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    },
    ask(question) {
      return rl.question(question);
    },
    close() {
      rl.close();
    },
  };
}

/** Human-driven engine: same session prompts and board tools as a real agent. */
export function createInteractiveFakeEnginePlugin(
  options: InteractiveFakeEngineOptions,
): EnginePlugin {
  let io: InteractiveIo | undefined = options.io;
  let ownedIo = false;
  let runIndex = 0;
  let lastTokens = 0;
  let remainingBudget: number | null = null;
  let hints: ToolPromptHints = { goals: [] };
  let sessionId: string | undefined;

  function write(text: string): void {
    (io ?? options.io)?.write(text);
  }

  async function ask(question: string): Promise<string> {
    const current = io ?? options.io;
    if (!current) {
      throw new Error("fake engine I/O is not started");
    }
    return current.ask(question);
  }

  return {
    async start(session) {
      runIndex = 0;
      lastTokens = 0;
      remainingBudget = null;
      hints = { goals: [] };
      sessionId = session.sessionId;
      if (!options.io) {
        io = createReadlineIo({
          stdin: options.stdin,
          stdout: options.stdout,
          onInterrupt: options.onInterrupt,
        });
        ownedIo = true;
      } else {
        io = options.io;
      }
      write("");
      write("fake エンジン — 人間がエージェントの一日を操作します。");
      write(`セッション: ${session.sessionId}`);
      if (session.environmentPrompt) {
        write(session.environmentPrompt.trim());
        write("");
      }
      write("エージェントと同じプロンプトとボードツールが出ます。");
      write("番号かツール名で呼び出し、done でこの run を終えます。Esc でひとつ戻る。Ctrl-C で切断。");
      write("help で一日の流れと一覧。help post のように名前や番号を付けると個別の説明。");
      write("");
    },

    async run(prompt: string, ctx?: EngineRunContext) {
      runIndex += 1;
      const toolLog: Array<{
        run: number;
        tool: string;
        args: unknown;
        isError?: boolean;
        result?: unknown;
      }> = [];
      const transcript: string[] = [`[fake run ${runIndex}]`, prompt.trim(), ""];
      const windDown = prompt.includes("セッション終了作業");

      write("");
      write(`======== run ${runIndex} ========`);
      if (sessionId) {
        write(`session ${sessionId}`);
      }
      write(
        `残量: ${remainingBudget === null ? "不明" : remainingBudget}    未完了目標: ${hints.goals.length} 件`,
      );
      if (hints.lastThreadId) {
        write(`直近スレッド: ${hints.lastThreadId}`);
      }
      write("");
      write(prompt.trim());
      write("");
      if (windDown) {
        write("※ 終了作業です。end_session を申し送り付きで呼んでください。");
        write("");
      }
      write("ツール:");
      write(formatToolMenu());
      write("");

      for (;;) {
        const line = await ask("ツール > ");
        if (isEscapeLine(line)) {
          write(
            "ツール選択です。Esc で戻る先はありません。done でこの run を終えます。",
          );
          continue;
        }
        const command = parseRunCommand(line);
        if (command.kind === "done") {
          transcript.push("(done)");
          break;
        }
        if (command.kind === "help") {
          write(formatToolsetHelp());
          continue;
        }
        if (command.kind === "help-tool") {
          const spec = resolveToolChoice(command.query);
          if (!spec) {
            write(
              `ツールが見つかりません: ${command.query}（help で一覧）`,
            );
            continue;
          }
          write(formatToolHelp(spec));
          continue;
        }
        if (command.kind === "error") {
          write(command.message);
          continue;
        }

        const spec = findTool(command.name);
        if (!spec) {
          write(`未知のツール: ${command.name}`);
          continue;
        }

        let args = command.args;
        if (args === undefined) {
          try {
            args = await promptToolArgs(spec, ask, write, hints);
          } catch (error) {
            if (isPromptCancelled(error)) {
              write("キャンセルしました。ツール選択に戻ります。");
              continue;
            }
            write(error instanceof Error ? error.message : String(error));
            continue;
          }
        }

        write(`→ ${spec.name} ${JSON.stringify(args)}`);
        const response = await options.callTool(spec.name, args);
        const parsed = parseToolJson(response);
        const entry = {
          run: runIndex,
          tool: spec.name,
          args,
          ...(response.isError ? { isError: true as const } : {}),
          ...(parsed ? { result: parsed } : {}),
        };
        toolLog.push(entry);
        const fromResult = remainingBudgetFrom(parsed);
        if (fromResult !== null) {
          remainingBudget = fromResult;
        }
        hints = applyToolSideEffects(spec.name, parsed, hints);
        const rendered = formatToolResult(response);
        write(rendered);
        transcript.push(`> ${spec.name} ${JSON.stringify(args)}`);
        transcript.push(rendered);
        transcript.push("");

        if (spec.name === "end_session" && response.isError !== true) {
          write("セッションを閉じました。");
          break;
        }
      }

      lastTokens = Math.max(1, toolLog.length);
      return {
        transcript: "",
        toolLog,
        remainingBudget,
        traceEvents: ctx?.trace
          ? toolLogToTraceEvents(runIndex, toolLog, ctx.trace)
          : undefined,
      };
    },

    async report() {
      return { tokens: lastTokens };
    },

    async stop() {
      if (ownedIo) {
        io?.close?.();
      }
      io = options.io;
      ownedIo = false;
      sessionId = undefined;
    },

    async dispose() {
      await this.stop();
    },
  };
}

export function createScriptedIo(lines: string[]): {
  io: InteractiveIo;
  output: () => string;
} {
  const chunks: string[] = [];
  let index = 0;
  return {
    io: {
      write(text) {
        chunks.push(text.endsWith("\n") ? text : `${text}\n`);
      },
      async ask(question) {
        chunks.push(question);
        const line = lines[index];
        if (line === undefined) {
          throw new Error(`unexpected prompt: ${question}`);
        }
        index += 1;
        return line;
      },
    },
    output: () => chunks.join(""),
  };
}
