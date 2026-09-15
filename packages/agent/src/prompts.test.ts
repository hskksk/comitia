import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLSET_OVERVIEW } from "./plugins/tool-catalog.js";
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
    expect(INITIAL_PROMPT).toContain("自分の行動で完了できる単位");
    expect(INITIAL_PROMPT).toContain("他者の返答や判断そのものを目標にせず");
    expect(INITIAL_PROMPT).toContain("今日試みる役割を 1 つ決め");
    expect(INITIAL_PROMPT).toContain("決め方は環境プロンプトの性格に従う");
    expect(INITIAL_PROMPT).toContain("場の状況は材料であり、条件表ではない");
    expect(INITIAL_PROMPT).not.toContain("situation.unclaimed_decided");
    expect(INITIAL_PROMPT).not.toContain("議論の態度");
    expect(INITIAL_PROMPT).toContain("環境プロンプトの各ロール指針");
    expect(INITIAL_PROMPT).not.toContain("コンセンサスを作る場");
    expect(INITIAL_PROMPT).not.toContain("タスクキューではない");
    expect(INITIAL_PROMPT).not.toContain("議論の態度");
    expect(INITIAL_PROMPT).not.toContain("layer=norm");
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

describe("TOOLSET_OVERVIEW", () => {
  it("reserves posts for information rather than asynchronous nagging", () => {
    expect(TOOLSET_OVERVIEW).toContain("新しい根拠・質問・整理・進捗");
    expect(TOOLSET_OVERVIEW).toContain(
      "催促、起床要求、未反応を伝えるだけの投稿には使わない",
    );
  });

  it("defaults write_memory to episodic and names layer=norm for retro", () => {
    expect(TOOLSET_OVERVIEW).toContain("既定");
    expect(TOOLSET_OVERVIEW).toContain("layer=norm");
    expect(TOOLSET_OVERVIEW).toContain(
      "他のエージェントと、登録オーナー以外の人間には見えない",
    );
    expect(TOOLSET_OVERVIEW).toContain("登録オーナーはチャットログと同じく読める");
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
    expect(prompt).toContain("決め方は環境プロンプトの性格に従う");
    expect(prompt).not.toContain("続きに取り組め");
  });

  it("asks the agent to continue actionable goals and pivot instead of nagging", () => {
    const prompt = buildRedrivePrompt({
      remainingBudget: 900,
      incompleteGoals: ["report を投稿する"],
      goalsEverSet: true,
    });
    expect(prompt).toContain("自分で進められる未完了目標");
    expect(prompt).toContain("催促や「まだ反応がない」と伝えるだけの投稿はしない");
    expect(prompt).toContain("list_work_claims");
    expect(prompt).toContain("set_goals で目標を組み直す");
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
    expect(prompt).toContain("誰の何を待ち、何が起きたら再開するか");
    expect(prompt).toContain("待っていることだけを伝える投稿はしない");
    expect(prompt).toContain("end_session");
    expect(prompt).not.toContain("sample.md");
    expect(prompt).not.toContain("規範へ提炼");
  });

  it("invites a norm retro only when retroDue", () => {
    const prompt = buildWindDownPrompt({
      remainingBudget: 12,
      reason: "予算不足",
      retroDue: true,
    });
    expect(prompt).toContain("個別記憶から規範へ提炼してよいか検討する");
    expect(prompt).toContain("大きく急に変えない");
    expect(prompt).toContain("プロジェクトルールと衝突する規範は書かない");
    expect(prompt).toContain("layer=norm");
  });
});
