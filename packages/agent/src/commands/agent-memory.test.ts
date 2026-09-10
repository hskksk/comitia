import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs, runCli } from "../cli.js";
import { agentMemoryCommand } from "./agent-memory.js";
import { UsageError } from "../cli-usage.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function writeConfig(configDir: string, extra?: { boardUrl?: string }) {
  await writeFile(
    join(configDir, "config.json"),
    `${JSON.stringify(
      {
        boardUrl: extra?.boardUrl ?? "http://127.0.0.1:8787",
        ownerToken: "comt_owner_test",
        ownerId: "owner-1",
        projectId: "project-1",
        agents: {
          mika: {
            agentId: "agent-1",
            token: "comt_agent_secret",
            engine: "claude-code",
          },
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

function collectStdout() {
  const stdout = new PassThrough();
  const chunks: string[] = [];
  stdout.on("data", (chunk) => chunks.push(String(chunk)));
  return { stdout, text: () => chunks.join("") };
}

describe("agent memory CLI", () => {
  it("parses agent memory and layer", () => {
    expect(parseCliArgs(["agent", "memory", "mika"])).toEqual({
      command: "agent-memory",
      name: "mika",
    });
    expect(parseCliArgs(["agent", "memory", "mika", "--layer", "norm"])).toEqual({
      command: "agent-memory",
      name: "mika",
      layer: "norm",
    });
    expect(() => parseCliArgs(["agent", "memory", "mika", "--layer", "secret"])).toThrow(
      UsageError,
    );
  });

  it("prints active norms then episodic memory without leaking the token", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-memory-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async (input: URL) => {
      expect(input.pathname).toBe("/v1/me/agents/agent-1/memory");
      expect(input.searchParams.get("layer")).toBeNull();
      return new Response(
        JSON.stringify({
          items: [
            { body: "ルール矛盾に気づいた", layer: "episodic" },
            { body: "対立する案を残す", layer: "norm" },
          ],
        }),
        { status: 200 },
      );
    });
    const { stdout, text } = collectStdout();
    await agentMemoryCommand({
      name: "mika",
      configDir,
      stdout,
      fetch: fetchMock as typeof fetch,
    });
    expect(text()).toBe(
      "規範\n対立する案を残す\n\n個別記憶\nルール矛盾に気づいた\n",
    );
    expect(text()).not.toContain("comt_");
  });

  it("filters by layer", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-memory-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    const fetchMock = vi.fn(async (input: URL) => {
      expect(String(input)).toContain("layer=norm");
      return new Response(
        JSON.stringify({ items: [{ body: "対立する案を残す", layer: "norm" }] }),
        { status: 200 },
      );
    });
    const { stdout, text } = collectStdout();
    await agentMemoryCommand({
      name: "mika",
      layer: "norm",
      configDir,
      stdout,
      fetch: fetchMock as typeof fetch,
    });
    expect(text()).toBe("規範\n対立する案を残す\n");
    expect(text()).not.toContain("個別記憶");
  });

  it("fails when the board rejects the owner", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-memory-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await writeConfig(configDir);

    await expect(
      agentMemoryCommand({
        name: "mika",
        configDir,
        stdout: collectStdout().stdout,
        fetch: (async () =>
          new Response(JSON.stringify({ error: "登録オーナーだけがエージェントの記憶を読めます" }), {
            status: 403,
          })) as typeof fetch,
      }),
    ).rejects.toThrow("ボード: 取得できません");
  });

  it("mentions agent memory in help", async () => {
    const { stdout, text } = collectStdout();
    await runCli(["help"], { stdout });
    expect(text()).toContain("agent memory");
    expect(text()).not.toContain("comt_");
  });
});
