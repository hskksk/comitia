import { afterEach, describe, expect, it } from "vitest";
import { FAKE_CONSOLE_DEFAULT_PORT } from "@comitia/shared";
import type { McpProxyToolResult } from "../mcp-proxy.js";
import { createEnginePlugin } from "./create-engine.js";
import { FakeConsole } from "./fake-console.js";
import {
  createInteractiveFakeEnginePlugin,
  createScriptedIo,
} from "./interactive-fake.js";

const GOAL_ID = "11111111-1111-4111-8111-111111111111";

function jsonResult(body: unknown, isError = false): McpProxyToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function readJson(url: string, init?: RequestInit): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe("fake console HTTP", () => {
  const consoles: FakeConsole[] = [];

  afterEach(async () => {
    await Promise.all(consoles.splice(0).map((item) => item.close()));
  });

  it("serves the console, runs a tool, then done", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const console = new FakeConsole({
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "get_briefing") {
          return jsonResult({ remaining_budget: 990, handover: "昨日の続き" });
        }
        if (name === "set_goals") {
          return jsonResult({
            remaining_budget: 985,
            goals: [{ id: GOAL_ID, text: "typo を直す", status: "open" }],
          });
        }
        return jsonResult({ ok: true });
      },
    });
    consoles.push(console);
    const url = await console.listen(0);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const home = await fetch(url);
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("fake 操作台");
    expect(html).toContain("ツールの結果");
    expect(html).toContain("右でツールを選ぶと、応答はここに出ます");

    const waiting = await readJson(`${url}/api/state`);
    expect(waiting.body.status).toBe("waiting");

    console.setSession({
      sessionId: "sess-console",
      environmentPrompt: "あなたは ウォーカー@ハル である。",
    });
    const run = console.run("1. get_briefing を呼ぶ");
    await viWaitForRunning(url);

    const briefing = await readJson(`${url}/api/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "get_briefing" }),
    });
    expect(briefing.status).toBe(200);
    expect(briefing.body.isError).toBeUndefined();
    expect(String(briefing.body.rendered)).toContain("remaining_budget");

    const goals = await readJson(`${url}/api/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "set_goals",
        args: { goals: ["typo を直す"] },
      }),
    });
    expect(goals.status).toBe(200);
    const state = goals.body.state as { hints: { goals: Array<{ id: string }> } };
    expect(state.hints.goals[0]?.id).toBe(GOAL_ID);

    const done = await readJson(`${url}/api/done`, { method: "POST" });
    expect(done.status).toBe(200);
    const result = await run;
    expect(calls.map((call) => call.name)).toEqual([
      "get_briefing",
      "set_goals",
    ]);
    expect(result.toolLog.map((entry) => entry.tool)).toEqual([
      "get_briefing",
      "set_goals",
    ]);
    expect(result.remainingBudget).toBe(985);

    const after = await readJson(`${url}/api/state`);
    expect(after.body.status).toBe("waiting");
    expect(after.body.log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "get_briefing" }),
        expect.objectContaining({ tool: "set_goals" }),
      ]),
    );
  });

  it("rejects tools while waiting and unknown names", async () => {
    const console = new FakeConsole({
      callTool: async () => jsonResult({}),
    });
    consoles.push(console);
    const url = await console.listen(0);
    const waiting = await readJson(`${url}/api/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "get_briefing" }),
    });
    expect(waiting.status).toBe(409);
    expect(waiting.body.error).toMatch(/tick を待っています/);

    const run = console.run("作業して");
    await viWaitForRunning(url);
    const unknown = await readJson(`${url}/api/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "not_a_tool" }),
    });
    expect(unknown.status).toBe(400);
    await readJson(`${url}/api/done`, { method: "POST" });
    await run;
  });

  it("ends the run when end_session succeeds", async () => {
    const console = new FakeConsole({
      callTool: async (name, args) => {
        if (name === "end_session") {
          expect(args).toEqual({ handover: "申し送り" });
          return jsonResult({ ok: true, remaining_budget: 0 });
        }
        return jsonResult({ ok: true });
      },
    });
    consoles.push(console);
    const url = await console.listen(0);
    const run = console.run("セッション終了作業。end_session を呼べ。");
    await viWaitForRunning(url);
    const state = await readJson(`${url}/api/state`);
    expect(state.body.windDown).toBe(true);
    const ended = await readJson(`${url}/api/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "end_session",
        args: { handover: "申し送り" },
      }),
    });
    expect(ended.status).toBe(200);
    const result = await run;
    expect(result.toolLog.map((entry) => entry.tool)).toEqual(["end_session"]);
    expect(result.remainingBudget).toBe(0);
  });

  it("keeps the run open after a gate error", async () => {
    const console = new FakeConsole({
      callTool: async () => ({
        content: [{ type: "text", text: "根拠必須" }],
        isError: true,
      }),
    });
    consoles.push(console);
    const url = await console.listen(0);
    const run = console.run("post して");
    await viWaitForRunning(url);
    const failed = await readJson(`${url}/api/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "post",
        args: { thread_id: GOAL_ID, type: "objection", body: "だめ" },
      }),
    });
    expect(failed.status).toBe(200);
    expect(failed.body.isError).toBe(true);
    const still = await readJson(`${url}/api/state`);
    expect(still.body.status).toBe("running");
    await readJson(`${url}/api/done`, { method: "POST" });
    const result = await run;
    expect(result.toolLog[0]).toMatchObject({ tool: "post", isError: true });
  });
});

describe("createEnginePlugin fake console", () => {
  it("binds a console when io is omitted", async () => {
    const previous = process.env.COMITIA_FAKE_CONSOLE_PORT;
    process.env.COMITIA_FAKE_CONSOLE_PORT = "0";
    const plugin = createEnginePlugin({
      engine: "fake",
      callTool: async () => jsonResult({ remaining_budget: 1 }),
    });
    try {
      const url = await plugin.ensureConsole?.();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const page = await fetch(url!);
      expect(await page.text()).toContain("fake 操作台");
    } finally {
      await plugin.dispose();
      if (previous === undefined) {
        delete process.env.COMITIA_FAKE_CONSOLE_PORT;
      } else {
        process.env.COMITIA_FAKE_CONSOLE_PORT = previous;
      }
    }
  });

  it("stays on TTY when io is injected", async () => {
    const plugin = createEnginePlugin({
      engine: "fake",
      callTool: async () => jsonResult({}),
      io: createScriptedIo(["done"]).io,
    });
    expect(await plugin.ensureConsole?.()).toBeUndefined();
  });

  it("stays on TTY when COMITIA_FAKE_TTY=1", async () => {
    const previous = process.env.COMITIA_FAKE_TTY;
    process.env.COMITIA_FAKE_TTY = "1";
    try {
      const plugin = createInteractiveFakeEnginePlugin({
        callTool: async () => jsonResult({}),
      });
      expect(await plugin.ensureConsole?.()).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.COMITIA_FAKE_TTY;
      } else {
        process.env.COMITIA_FAKE_TTY = previous;
      }
    }
  });
});

it("keeps the default console port next to the board", () => {
  expect(FAKE_CONSOLE_DEFAULT_PORT).toBe(8790);
});

async function viWaitForRunning(url: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const state = await readJson(`${url}/api/state`);
    if (state.body.status === "running") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("console did not enter a run");
}
