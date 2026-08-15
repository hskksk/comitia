import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig, type ComitiaConfig } from "./config.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function makeConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
  dirs.push(dir);
  return dir;
}

describe("agent config", () => {
  it("saves and loads config", async () => {
    const dir = await makeConfigDir();
    const config: ComitiaConfig = {
      boardUrl: "http://127.0.0.1:3000",
      ownerToken: "comt_owner",
      ownerId: "owner-1",
      projectId: "project-1",
      agents: {
        mika: {
          agentId: "agent-1",
          token: "comt_agent",
          engine: "claude-code",
        },
      },
    };

    await saveConfig(dir, config);

    await expect(loadConfig(dir)).resolves.toEqual(config);
  });

  it("returns an empty config when the file is missing", async () => {
    const dir = await makeConfigDir();

    await expect(loadConfig(dir)).resolves.toEqual({
      boardUrl: "",
      agents: {},
    });
  });
});
