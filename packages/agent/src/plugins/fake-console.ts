import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { FAKE_CONSOLE_DEFAULT_PORT } from "@comitia/shared";
import type { McpProxyToolResult } from "../mcp-proxy.js";
import { toolLogToTraceEvents } from "../trace-format.js";
import {
  applyToolSideEffects,
  BOARD_TOOLS,
  findTool,
  formatToolResult,
  parseToolJson,
  remainingBudgetFrom,
  type ToolPromptHints,
} from "./board-tools.js";
import { fakeConsolePageHtml } from "./fake-console-page.js";
import type { EngineRunContext } from "./types.js";

export { FAKE_CONSOLE_DEFAULT_PORT };

export type FakeConsoleLogEntry = {
  tool: string;
  args: unknown;
  isError?: boolean;
  result?: unknown;
  rendered: string;
};

export type FakeConsoleToolLogEntry = {
  run: number;
  tool: string;
  args: unknown;
  isError?: boolean;
  result?: unknown;
};

export type FakeConsoleRunResult = {
  transcript: string;
  toolLog: FakeConsoleToolLogEntry[];
  remainingBudget: number | null;
  traceEvents?: ReturnType<typeof toolLogToTraceEvents>;
};

export type FakeConsoleState = {
  status: "waiting" | "running" | "closed";
  sessionId?: string;
  environmentPrompt?: string;
  runIndex: number;
  prompt: string;
  windDown: boolean;
  remainingBudget: number | null;
  hints: ToolPromptHints;
  log: FakeConsoleLogEntry[];
  tools: typeof BOARD_TOOLS;
};

type RunGate = {
  prompt: string;
  windDown: boolean;
  toolLog: FakeConsoleToolLogEntry[];
  log: FakeConsoleLogEntry[];
  resolve: (result: FakeConsoleRunResult) => void;
};

export function preferredFakeConsolePort(): number {
  const raw = process.env.COMITIA_FAKE_CONSOLE_PORT;
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535) {
      return parsed;
    }
  }
  return FAKE_CONSOLE_DEFAULT_PORT;
}

export function tryOpenBrowser(url: string): void {
  const args =
    process.platform === "darwin"
      ? (["open", [url]] as const)
      : process.platform === "win32"
        ? (["cmd", ["/c", "start", "", url]] as const)
        : (["xdg-open", [url]] as const);
  execFile(args[0], args[1], () => undefined);
}

function listenLoopback(
  server: Server,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error("fake console failed to bind"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export class FakeConsole {
  url = "";
  private http: Server | undefined;
  private sessionId: string | undefined;
  private environmentPrompt: string | undefined;
  private runIndex = 0;
  private remainingBudget: number | null = null;
  private hints: ToolPromptHints = { goals: [] };
  private current: RunGate | undefined;
  private lastLog: FakeConsoleLogEntry[] = [];
  private lastTokens = 0;
  private closed = false;
  private invokeChain = Promise.resolve();
  private readonly page = fakeConsolePageHtml();

  constructor(
    private readonly options: {
      callTool: (
        name: string,
        args?: Record<string, unknown>,
      ) => Promise<McpProxyToolResult>;
      write?: (text: string) => void;
    },
  ) {}

  tokens(): number {
    return this.lastTokens;
  }

  snapshot(): FakeConsoleState {
    return {
      status: this.closed ? "closed" : this.current ? "running" : "waiting",
      sessionId: this.sessionId,
      environmentPrompt: this.environmentPrompt,
      runIndex: this.runIndex,
      prompt: this.current?.prompt ?? "",
      windDown: this.current?.windDown ?? false,
      remainingBudget: this.remainingBudget,
      hints: {
        lastThreadId: this.hints.lastThreadId,
        goals: [...this.hints.goals],
      },
      log: this.current?.log ?? this.lastLog,
      tools: BOARD_TOOLS,
    };
  }

  async listen(port = preferredFakeConsolePort()): Promise<string> {
    if (this.http) {
      return this.url;
    }
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "1mb" }));
    app.get("/", (_req, res) => {
      res.set("cache-control", "no-store").type("html").send(this.page);
    });
    app.get("/api/state", (_req, res) => {
      res.json(this.snapshot());
    });
    app.post("/api/tools", (req, res, next) => {
      void this.handleTool(req.body)
        .then((body) => res.json(body))
        .catch(next);
    });
    app.post("/api/done", (_req, res, next) => {
      try {
        this.done();
        res.json({ ok: true, state: this.snapshot() });
      } catch (error) {
        next(error);
      }
    });
    app.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        const status =
          error instanceof ConsoleHttpError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 500;
        const message =
          error instanceof Error ? error.message : String(error);
        res.status(status).json({ error: message });
      },
    );

    const server = createServer(app);
    const preferred = port;
    let bound: number;
    try {
      bound = await listenLoopback(server, preferred);
    } catch (error) {
      const code =
        error instanceof Error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code === "EADDRINUSE" && preferred !== 0) {
        server.close();
        const retry = createServer(app);
        bound = await listenLoopback(retry, 0);
        this.http = retry;
        this.url = `http://127.0.0.1:${bound}`;
        return this.url;
      }
      throw error;
    }
    this.http = server;
    this.url = `http://127.0.0.1:${bound}`;
    return this.url;
  }

  setSession(session: {
    sessionId: string;
    environmentPrompt?: string;
  }): void {
    this.sessionId = session.sessionId;
    this.environmentPrompt = session.environmentPrompt;
    this.runIndex = 0;
    this.remainingBudget = null;
    this.hints = { goals: [] };
    this.lastLog = [];
  }

  async run(
    prompt: string,
    ctx?: EngineRunContext,
  ): Promise<FakeConsoleRunResult> {
    if (this.closed) {
      throw new Error("fake console is closed");
    }
    if (this.current) {
      throw new Error("fake console already has a run");
    }
    this.runIndex += 1;
    this.write("");
    this.write(`======== run ${this.runIndex} ========`);
    if (this.sessionId) {
      this.write(`session ${this.sessionId}`);
    }
    this.write(prompt.trim());
    this.write(`操作台: ${this.url || "（起動前）"}`);
    return new Promise((resolve) => {
      this.current = {
        prompt: prompt.trim(),
        windDown: prompt.includes("セッション終了作業"),
        toolLog: [],
        log: [],
        resolve: (result) => {
          if (ctx?.trace) {
            result.traceEvents = toolLogToTraceEvents(
              this.runIndex,
              result.toolLog,
              ctx.trace,
            );
          }
          resolve(result);
        },
      };
    });
  }

  done(): FakeConsoleState {
    const gate = this.requireRun();
    this.finish(gate);
    return this.snapshot();
  }

  clearSession(): void {
    if (this.current) {
      this.finish(this.current);
    }
    this.sessionId = undefined;
    this.environmentPrompt = undefined;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.current) {
      this.finish(this.current);
    }
    const server = this.http;
    this.http = undefined;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private write(text: string): void {
    this.options.write?.(text);
  }

  private requireRun(): RunGate {
    if (!this.current) {
      throw new ConsoleHttpError(409, "run がありません。tick を待っています。");
    }
    return this.current;
  }

  private finish(gate: RunGate): void {
    if (this.current !== gate) {
      return;
    }
    this.current = undefined;
    this.lastLog = gate.log;
    this.lastTokens = Math.max(1, gate.toolLog.length);
    gate.resolve({
      transcript: "",
      toolLog: gate.toolLog,
      remainingBudget: this.remainingBudget,
    });
  }

  private handleTool(body: unknown): Promise<{
    ok: true;
    rendered: string;
    isError?: boolean;
    state: FakeConsoleState;
  }> {
    const run = this.invokeChain.then(() => this.invokeTool(body));
    this.invokeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async invokeTool(body: unknown): Promise<{
    ok: true;
    rendered: string;
    isError?: boolean;
    state: FakeConsoleState;
  }> {
    const gate = this.requireRun();
    const parsed = parseToolBody(body);
    const spec = findTool(parsed.name);
    if (!spec) {
      throw new ConsoleHttpError(400, `未知のツール: ${parsed.name}`);
    }
    this.write(`→ ${spec.name} ${JSON.stringify(parsed.args)}`);
    const response = await this.options.callTool(spec.name, parsed.args);
    const json = parseToolJson(response);
    const rendered = formatToolResult(response);
    const entry: FakeConsoleToolLogEntry = {
      run: this.runIndex,
      tool: spec.name,
      args: parsed.args,
      ...(response.isError ? { isError: true as const } : {}),
      ...(json ? { result: json } : {}),
    };
    gate.toolLog.push(entry);
    gate.log.push({
      tool: spec.name,
      args: parsed.args,
      ...(response.isError ? { isError: true as const } : {}),
      ...(json ? { result: json } : {}),
      rendered,
    });
    const fromResult = remainingBudgetFrom(json);
    if (fromResult !== null) {
      this.remainingBudget = fromResult;
    }
    this.hints = applyToolSideEffects(spec.name, json, this.hints);
    this.write(rendered);
    if (spec.name === "end_session" && response.isError !== true) {
      this.write("セッションを閉じました。");
      this.finish(gate);
    }
    return {
      ok: true,
      rendered,
      ...(response.isError ? { isError: true as const } : {}),
      state: this.snapshot(),
    };
  }
}

class ConsoleHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ConsoleHttpError";
  }
}

function parseToolBody(body: unknown): {
  name: string;
  args: Record<string, unknown>;
} {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ConsoleHttpError(400, "JSON オブジェクトを送ってください");
  }
  const record = body as { name?: unknown; args?: unknown };
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    throw new ConsoleHttpError(400, "name はツール名です");
  }
  if (record.args === undefined) {
    return { name: record.name, args: {} };
  }
  if (
    record.args === null ||
    typeof record.args !== "object" ||
    Array.isArray(record.args)
  ) {
    throw new ConsoleHttpError(400, "args はオブジェクトにしてください");
  }
  return { name: record.name, args: record.args as Record<string, unknown> };
}
