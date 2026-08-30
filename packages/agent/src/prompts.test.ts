import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRedrivePrompt, buildWindDownPrompt, INITIAL_PROMPT } from "./prompts.js";

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("INITIAL_PROMPT", () => {
  it("names no concrete file or task, only the collect → decide → declare → start steps", () => {
    expect(INITIAL_PROMPT).not.toContain("sample.md");
    expect(INITIAL_PROMPT).not.toContain("typo");
    expect(INITIAL_PROMPT).toContain("get_briefing");
    expect(INITIAL_PROMPT).toContain("set_goals");
    expect(INITIAL_PROMPT).toContain("検討の材料である");
    expect(INITIAL_PROMPT).toContain("完成した提案まで書き切らなくてよい");
    expect(INITIAL_PROMPT).toContain("今日の立ち位置を 1 つ決め");
    expect(INITIAL_PROMPT).toContain("situation.unclaimed_decided");
    expect(INITIAL_PROMPT).toContain("環境プロンプトの各ロール指針");
    const unclaimedAt = INITIAL_PROMPT.indexOf("situation.unclaimed_decided");
    const emptyBoardAt = INITIAL_PROMPT.indexOf(
      "オープンなスレッドもコメントも、未着手の決定済み実装も無い → 検討",
    );
    expect(unclaimedAt).toBeGreaterThan(-1);
    expect(emptyBoardAt).toBeGreaterThan(unclaimedAt);
    expect(INITIAL_PROMPT).not.toContain("コンセンサスを作る場");
    expect(INITIAL_PROMPT).not.toContain("タスクキューではない");
  });

  it("leaves no docs/sample.md example in shippable source (poc/ and test fixtures excluded)", async () => {
    const roots = [
      join(import.meta.dirname, "."),
      join(import.meta.dirname, "../../board/src/mcp"),
    ];
    for (const root of roots) {
      const files = await collectFiles(root);
      for (const file of files) {
        const content = await readFile(file, "utf8");
        expect(content, file).not.toContain("docs/sample.md");
      }
    }
  });
});

describe("buildRedrivePrompt", () => {
  it("asks the agent to set a goal when none has ever been declared", () => {
    const prompt = buildRedrivePrompt({
      remainingBudget: 997,
      incompleteGoals: [],
      goalsEverSet: false,
    });
    expect(prompt).toContain("目標がまだ宣言されていない");
    expect(prompt).toContain("set_goals");
    expect(prompt).toContain("未着手の決定済み実装があれば実行");
    expect(prompt).not.toContain("続きに取り組め");
  });

  it("asks the agent to continue its declared goals otherwise", () => {
    const prompt = buildRedrivePrompt({
      remainingBudget: 900,
      incompleteGoals: ["report を投稿する"],
      goalsEverSet: true,
    });
    expect(prompt).toContain("続きに取り組め");
    expect(prompt).toContain("report を投稿する");
  });

  it("prints (なし) when goals were set but all completed", () => {
    const prompt = buildRedrivePrompt({
      remainingBudget: 900,
      incompleteGoals: [],
      goalsEverSet: true,
    });
    expect(prompt).toContain("（なし）");
  });
});

describe("buildWindDownPrompt", () => {
  it("mentions updating memory but names no example file", () => {
    const prompt = buildWindDownPrompt({ remainingBudget: 12, reason: "予算不足" });
    expect(prompt).toContain("個別記憶を更新してよい");
    expect(prompt).toContain("end_session");
    expect(prompt).not.toContain("sample.md");
  });
});
