import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { readToolLog } from "./log.js";
import { OUT_DIR } from "./paths.js";
import { printResultsTable, type StepResult } from "./results.js";

/** 標準環境の汚染チェック対象パス */
const POLLUTION_PATHS = [
  path.join(homedir(), ".claude.json"),
  path.join(homedir(), ".claude"),
  path.join(homedir(), ".config", "opencode"),
] as const;

interface DirSnapshot {
  kind: "dir";
  entries: Record<string, string>;
}

interface FileSnapshot {
  kind: "file";
  content: string;
}

interface MissingSnapshot {
  kind: "missing";
}

type PathSnapshot = DirSnapshot | FileSnapshot | MissingSnapshot;

type EnvSnapshot = Record<string, PathSnapshot>;

/** ディレクトリを再帰的にスナップショット（相対パス → 内容 base64） */
function snapshotDir(dirPath: string, base = dirPath): Record<string, string> {
  const entries: Record<string, string> = {};
  if (!existsSync(dirPath)) {
    return entries;
  }
  for (const name of readdirSync(dirPath)) {
    const full = path.join(dirPath, name);
    const rel = path.relative(base, full);
    const st = statSync(full);
    if (st.isDirectory()) {
      Object.assign(entries, snapshotDir(full, base));
    } else if (st.isFile()) {
      entries[rel] = readFileSync(full).toString("base64");
    }
  }
  return entries;
}

function takeSnapshot(targetPath: string): PathSnapshot {
  if (!existsSync(targetPath)) {
    return { kind: "missing" };
  }
  const st = statSync(targetPath);
  if (st.isDirectory()) {
    return { kind: "dir", entries: snapshotDir(targetPath) };
  }
  return { kind: "file", content: readFileSync(targetPath, "utf8") };
}

function takeEnvSnapshot(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const p of POLLUTION_PATHS) {
    snap[p] = takeSnapshot(p);
  }
  return snap;
}

function snapshotsEqual(a: PathSnapshot, b: PathSnapshot): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "missing") {
    return true;
  }
  if (a.kind === "file" && b.kind === "file") {
    return a.content === b.content;
  }
  if (a.kind === "dir" && b.kind === "dir") {
    const aKeys = Object.keys(a.entries).sort();
    const bKeys = Object.keys(b.entries).sort();
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    return aKeys.every((k, i) => k === bKeys[i] && a.entries[k] === b.entries[k]);
  }
  return false;
}

function diffSnapshots(before: EnvSnapshot, after: EnvSnapshot): string[] {
  const diffs: string[] = [];
  for (const p of POLLUTION_PATHS) {
    if (!snapshotsEqual(before[p], after[p])) {
      diffs.push(p);
    }
  }
  return diffs;
}

/** 子プロセスを起動して stdout/stderr を収集する */
export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  },
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            child.kill("SIGTERM");
          }, options.timeoutMs)
        : undefined;

    child.on("error", (err: Error) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code: number | null) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

/** CLI が PATH にあるか */
export function commandExists(command: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    const full = path.join(dir, command);
    if (existsSync(full)) {
      return true;
    }
  }
  return false;
}

/** CLI の --help 出力にフラグが含まれるか */
export async function cliHasFlag(command: string, flag: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await runProcess(command, ["--help"], {
      cwd: process.cwd(),
      timeoutMs: 15_000,
    });
    return `${stdout}\n${stderr}`.includes(flag);
  } catch {
    return false;
  }
}

export interface HarnessOptions {
  engineName: string;
  logPath: string;
  run: (ctx: { workDir: string; logPath: string }) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>;
  timeoutMs?: number;
}

/** 実エンジン起動の共通ハーネス */
export async function runHarness(options: HarnessOptions): Promise<number> {
  const results: StepResult[] = [];
  const workDir = mkdtempSync(path.join(tmpdir(), `comitia-poc-${options.engineName}-`));
  const logPath = options.logPath;
  const beforeSnap = takeEnvSnapshot();

  mkdirSync(OUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const transcriptPath = path.join(
    OUT_DIR,
    `${options.engineName}-transcript-${timestamp}.txt`,
  );

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;

  try {
    const runResult = await options.run({ workDir, logPath });
    stdout = runResult.stdout;
    stderr = runResult.stderr;
    exitCode = runResult.exitCode;

    writeFileSync(
      transcriptPath,
      [
        `# ${options.engineName} transcript`,
        `# exitCode: ${exitCode}`,
        `# workDir: ${workDir}`,
        "",
        "=== stdout ===",
        stdout,
        "",
        "=== stderr ===",
        stderr,
      ].join("\n"),
      "utf8",
    );

    results.push({
      name: "エンジン起動",
      pass: exitCode === 0,
      detail:
        exitCode === 0
          ? `exit 0, ログ: ${transcriptPath}`
          : `exit ${exitCode}, ログ: ${transcriptPath}`,
    });
  } catch (error) {
    results.push({
      name: "エンジン起動",
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // JSONL ログ検証
  const logEntries = readToolLog(logPath);
  const calledTools = logEntries.map((e) => e.tool);
  const hasBriefing = calledTools.includes("get_briefing");
  const hasPost = calledTools.includes("post");
  const hasEndSession = calledTools.includes("end_session");
  const logOk = hasBriefing && hasPost && hasEndSession;
  results.push({
    name: "JSONL ツールログ",
    pass: logOk,
    detail: logOk
      ? `${logEntries.length} 件: ${calledTools.join(" → ")}`
      : `不足: briefing=${hasBriefing} post=${hasPost} end_session=${hasEndSession} (${calledTools.join(", ")})`,
  });

  // 一時ディレクトリ削除
  try {
    rmSync(workDir, { recursive: true, force: true });
    results.push({
      name: "一時ディレクトリ削除",
      pass: !existsSync(workDir),
      detail: workDir,
    });
  } catch (error) {
    results.push({
      name: "一時ディレクトリ削除",
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // 標準環境の汚染チェック
  const afterSnap = takeEnvSnapshot();
  const diffs = diffSnapshots(beforeSnap, afterSnap);
  results.push({
    name: "標準環境の汚染チェック",
    pass: diffs.length === 0,
    detail:
      diffs.length === 0
        ? "差分なし"
        : `変更あり: ${diffs.join(", ")}`,
  });

  printResultsTable(`${options.engineName} 実エンジン検証`, results);

  const allPass = results.every((r) => r.pass);
  return allPass ? 0 : 1;
}

/** SKIP を表示して exit 2 */
export function skipAndExit(reason: string): void {
  console.log(`\nSKIP: ${reason}\n`);
  process.exit(2);
}
