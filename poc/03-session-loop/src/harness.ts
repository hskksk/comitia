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
import { allGoalsCompleted, hasSetGoals } from "./goals.js";
import { analyzeRunIdle } from "./idle-detection.js";
import { latestRemainingBudget, readToolLog, sliceLogByRun } from "./log.js";
import { OUT_DIR } from "./paths.js";
import { printResultsTable, type StepResult } from "./results.js";
import type { SessionLoopResult } from "./session-loop.js";

const POLLUTION_PATHS = [
  path.join(homedir(), ".claude.json"),
  path.join(homedir(), ".claude"),
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

export function skipAndExit(reason: string): void {
  console.log(`\nSKIP: ${reason}\n`);
  process.exit(2);
}

/** セッションループ結果の共通検証 */
export function verifySessionLoopResult(
  result: SessionLoopResult,
  options?: { minRuns?: number; maxRuns?: number; expectIdleStop?: boolean },
): StepResult[] {
  const minRuns = options?.minRuns ?? 3;
  const maxRuns = options?.maxRuns ?? 5;
  const results: StepResult[] = [];

  const runCount = result.runs.length;
  const runCountOk = runCount >= minRuns && runCount <= maxRuns;
  results.push({
    name: "run 回数（3〜5）",
    pass: runCountOk,
    detail: `${runCount} run`,
  });

  const setGoalsOk = hasSetGoals(result.entries);
  results.push({
    name: "set_goals 実行",
    pass: setGoalsOk,
    detail: setGoalsOk ? "宣言あり" : "未実行",
  });

  const runsWithTools = result.runs.filter((run) => {
    const runEntries = sliceLogByRun(result.entries, run.runIndex);
    return runEntries.length > 0;
  }).length;
  const continuationOk = runsWithTools >= 2;
  results.push({
    name: "複数 run でツール実行",
    pass: continuationOk,
    detail: `ツールあり run: ${runsWithTools}`,
  });

  const budgetStart = 100;
  const budgetEnd = latestRemainingBudget(result.entries);
  const budgetOk = budgetEnd !== null && budgetEnd < budgetStart;
  results.push({
    name: "活動量残量の伝播",
    pass: budgetOk,
    detail:
      budgetEnd === null
        ? "remaining_budget 未検出"
        : `${budgetStart} → ${budgetEnd}`,
  });

  const redriveOk = result.runs.some(
    (run) => run.runIndex >= 2 && run.phase === "work",
  );
  results.push({
    name: "再駆動 run 実行",
    pass: redriveOk,
    detail: redriveOk ? "run 2 以降あり" : "再駆動なし",
  });

  const endSessionOk = result.entries.some(
    (entry) => entry.tool === "end_session" && entry.isError !== true,
  );
  results.push({
    name: "end_session 完了",
    pass: endSessionOk,
    detail: endSessionOk ? "申し送りあり" : "未実行",
  });

  if (options?.expectIdleStop) {
    const idleRunCount = result.runs.filter((run) =>
      analyzeRunIdle(sliceLogByRun(result.entries, run.runIndex)).idle,
    ).length;
    const idleOk = idleRunCount >= 2;
    results.push({
      name: "空転検知で停止",
      pass: idleOk,
      detail: `空転 run ${idleRunCount} 件`,
    });
  } else {
    const goalsOk = allGoalsCompleted(result.entries);
    results.push({
      name: "目標完走",
      pass: goalsOk,
      detail: goalsOk ? "全目標 completed" : "未完了あり",
    });
  }

  results.push({
    name: "最終フェーズ",
    pass: result.finalPhase === "done",
    detail: `${result.finalPhase} (${result.stopReason})`,
  });

  return results;
}

export interface ClaudeHarnessOptions {
  logPath: string;
  workDir: string;
  runSession: () => Promise<{
    loopResult: SessionLoopResult;
    transcripts: string[];
  }>;
}

export async function runClaudeHarness(
  options: ClaudeHarnessOptions,
): Promise<number> {
  const beforeSnap = takeEnvSnapshot();
  mkdirSync(OUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summaryPath = path.join(OUT_DIR, `claude-session-loop-${timestamp}.json`);

  let loopResult: SessionLoopResult | null = null;
  const results: StepResult[] = [];

  try {
    const session = await options.runSession();
    loopResult = session.loopResult;

    writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          runs: loopResult.runs,
          stopReason: loopResult.stopReason,
          finalPhase: loopResult.finalPhase,
          transcripts: session.transcripts.length,
        },
        null,
        2,
      ),
      "utf8",
    );

    results.push({
      name: "セッションループ起動",
      pass: loopResult.runs.every((run) => run.exitCode === 0),
      detail: `${loopResult.runs.length} run, ログ: ${summaryPath}`,
    });
  } catch (error) {
    results.push({
      name: "セッションループ起動",
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (loopResult) {
    results.push(...verifySessionLoopResult(loopResult));
  }

  try {
    rmSync(options.workDir, { recursive: true, force: true });
    results.push({
      name: "一時ディレクトリ削除",
      pass: !existsSync(options.workDir),
      detail: options.workDir,
    });
  } catch (error) {
    results.push({
      name: "一時ディレクトリ削除",
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const afterSnap = takeEnvSnapshot();
  const diffs = diffSnapshots(beforeSnap, afterSnap);
  results.push({
    name: "標準環境の汚染チェック",
    pass: diffs.length === 0,
    detail: diffs.length === 0 ? "差分なし" : `変更あり: ${diffs.join(", ")}`,
  });

  printResultsTable("Claude Code セッションループ検証", results);
  return results.every((r) => r.pass) ? 0 : 1;
}

export function copyFixturesToWorkDir(workDir: string, fixturesDir: string): void {
  mkdirSync(path.join(workDir, "docs"), { recursive: true });
  writeFileSync(
    path.join(workDir, "docs", "sample.md"),
    readFileSync(path.join(fixturesDir, "sample.md"), "utf8"),
    "utf8",
  );
}
