import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONALITY_PRESETS } from "@comitia/shared";
import { parseCliArgs, runCli } from "../cli.js";
import { agentShowCommand } from "./agent-show.js";
import { updateCommand } from "./update.js";
import { loadConfig } from "../config.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function writeConfig(
  configDir: string,
  extra?: {
    boardUrl?: string;
    ownerToken?: string;
    engine?: string;
    model?: string;
  },
): Promise<void> {
  await writeFile(
    join(configDir, "config.json"),
    `${JSON.stringify(
      {
        boardUrl: extra?.boardUrl ?? "http://127.0.0.1:8787",
        ownerToken: extra?.ownerToken ?? "comt_owner_test",
        ownerId: "owner-1",
        projectId: "project-1",
        agents: {
          mika: {
            agentId: "agent-1",
            token: "comt_agent_secret",
            engine: extra?.engine ?? "claude-code",
            ...(extra?.model ? { model: extra.model } : {}),
          },
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

function collectStdout(): {
  stdout: PassThrough;
  text: () => string;
} {
  const stdout = new PassThrough();
  const chunks: string[] = [];
  stdout.on("data", (chunk) => chunks.push(String(chunk)));
  return { stdout, text: () => chunks.join("") };
}

describe("M27-2 personality CLI", () => {
  it("parses personality list/show and agent show", () => {
    expect(parseCliArgs(["personality", "list"])).toEqual({
      command: "personality-list",
    });
    expect(parseCliArgs(["personality", "show", "慎重"])).toEqual({
      command: "personality-show",
      name: "慎重",
    });
    expect(parseCliArgs(["agent", "show", "mika"])).toEqual({
      command: "agent-show",
      name: "mika",
    });
  });

  it("prints packaged examples without a board", async () => {
    const { stdout, text } = collectStdout();
    await runCli(["personality", "list"], { stdout });
    const cautious = PERSONALITY_PRESETS.find((preset) => preset.id === "慎重");
    expect(text()).toContain(`慎重\n${cautious?.body}`);
    expect(text()).toContain("対立保持\n");
    expect(text()).not.toContain("comt_");
  });

  it("prints one example by name and rejects unknown names", async () => {
    const { stdout, text } = collectStdout();
    await runCli(["personality", "show", "慎重"], { stdout });
    const cautious = PERSONALITY_PRESETS.find((preset) => preset.id === "慎重");
    expect(text()).toBe(`慎重\n${cautious?.body}\n`);

    await expect(runCli(["personality", "show", "存在しない"])).rejects.toThrow(
      "comitia personality list",
    );
  });

  it("shows local settings and board fields without leaking the token", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-show-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir, { engine: "fake", model: "composer-2.5" });

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "agent-1",
              displayName: "ウォーカー",
              engine: "fake",
              personality: "リスクと失敗モードを先に出す。",
            },
          ],
        }),
        { status: 200 },
      );
    });
    const { stdout, text } = collectStdout();
    await agentShowCommand({
      name: "mika",
      configDir,
      stdout,
      fetch: fetchMock as typeof fetch,
    });
    const output = text();
    expect(output).toContain("名前: mika");
    expect(output).toContain("agentId: agent-1");
    expect(output).toContain("表示名: ウォーカー");
    expect(output).toContain("性格: リスクと失敗モードを先に出す。");
    expect(output).toContain("エンジン（ローカル）: fake");
    expect(output).toContain("エンジン（ボード）: fake");
    expect(output).toContain("モデル: composer-2.5");
    expect(output).not.toContain("comt_");
    expect(output).not.toContain("警告");
  });

  it("warns when local and board engines differ", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-show-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir, { engine: "fake" });

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "agent-1",
              displayName: "ミカ",
              engine: "claude-code",
              personality: null,
            },
          ],
        }),
        { status: 200 },
      );
    });
    const { stdout, text } = collectStdout();
    await agentShowCommand({
      name: "mika",
      configDir,
      stdout,
      fetch: fetchMock as typeof fetch,
    });
    expect(text()).toContain("性格: （未設定）");
    expect(text()).toContain(
      "警告: ローカルのエンジン（fake）とボード（claude-code）が違います。",
    );
  });

  it("keeps local lines when the board is unreachable", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-show-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const { stdout, text } = collectStdout();
    await agentShowCommand({
      name: "mika",
      configDir,
      stdout,
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    const output = text();
    expect(output).toContain("名前: mika");
    expect(output).toContain("エンジン（ローカル）: claude-code");
    expect(output).toContain("ボード: 取得できません（ECONNREFUSED）");
    expect(output).not.toContain("表示名:");
    expect(output).not.toContain("comt_");
  });

  it("patches the board when updating engine", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-update-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "agent-1",
          displayName: "ミカ",
          engine: "fake",
          personality: null,
        }),
        { status: 200 },
      );
    });
    const { stdout, text } = collectStdout();
    await updateCommand({
      name: "mika",
      engine: "fake",
      configDir,
      stdout,
      fetch: fetchMock as typeof fetch,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ engine: "fake" }),
      }),
    );
    expect((await loadConfig(configDir)).agents.mika?.engine).toBe("fake");
    expect(text()).toContain("mika の engine を fake に更新しました。");
  });
});
