#!/usr/bin/env node
/**
 * 偽エンジン: セッションループのアダプタロジックを API キー不要で検証する
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createContinuationFakeRunner,
  createIdleFakeRunner,
} from "./fake-runner.js";
import { verifySessionLoopResult } from "./harness.js";
import { printResultsTable, type StepResult } from "./results.js";
import { runSessionLoop } from "./session-loop.js";

async function runScenario(input: {
  title: string;
  logPath: string;
  runner: ReturnType<typeof createContinuationFakeRunner>;
  expectIdleStop?: boolean;
}): Promise<StepResult[]> {
  const result = await runSessionLoop({
    logPath: input.logPath,
    maxRuns: 5,
    idleRunLimit: 2,
    runEngine: input.runner,
  });
  return verifySessionLoopResult(result, {
    minRuns: 3,
    maxRuns: 5,
    expectIdleStop: input.expectIdleStop,
  });
}

async function main(): Promise<void> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "comitia-poc3-fake-"));
  const continuationLog = path.join(tmpDir, "continuation.jsonl");
  const idleLog = path.join(tmpDir, "idle.jsonl");

  const allResults: StepResult[] = [];

  const continuationResults = await runScenario({
    title: "目標完走",
    logPath: continuationLog,
    runner: createContinuationFakeRunner(continuationLog),
  });
  for (const step of continuationResults) {
    allResults.push({
      ...step,
      name: `[完走] ${step.name}`,
    });
  }

  const idleResults = await runScenario({
    title: "空転検知",
    logPath: idleLog,
    runner: createIdleFakeRunner(idleLog),
    expectIdleStop: true,
  });
  for (const step of idleResults) {
    allResults.push({
      ...step,
      name: `[空転] ${step.name}`,
    });
  }

  rmSync(tmpDir, { recursive: true, force: true });

  printResultsTable("偽エンジン セッションループ検証", allResults);
  process.exit(allResults.every((step) => step.pass) ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("run-fake-engine エラー:", error);
  process.exit(1);
});
