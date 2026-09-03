import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { namedWorkspacePath } from "enginebay";
import { comitiaWorkspaceId } from "./session-loop.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const libPath = join(repoRoot, "scripts/dogfood/lib.mjs");

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function runDogfoodLib(args: string[], env: NodeJS.ProcessEnv) {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
  if (!("COMITIA_WORK_DIR" in env)) {
    delete merged.COMITIA_WORK_DIR;
  }
  return spawnSync(process.execPath, [libPath, "run", ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    env: merged,
  });
}

describe("dogfood workspace resolution", () => {
  it("prints the named XDG workspace when COMITIA_WORK_DIR is unset", async () => {
    const home = await mkdtemp(join(tmpdir(), "comitia-dogfood-home-"));
    const xdg = join(home, "xdg-data");
    cleanups.push(() => rm(home, { recursive: true }));
    const expected = namedWorkspacePath(
      comitiaWorkspaceId("ミカ"),
      { XDG_DATA_HOME: xdg, HOME: home },
      home,
    );

    const result = runDogfoodLib(["resolve-work-dir"], {
      HOME: home,
      XDG_DATA_HOME: xdg,
      COMITIA_DOGFOOD_AGENT_NAME: "ミカ",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stdout).not.toContain(".comitia/work");
  });

  it("keeps COMITIA_WORK_DIR as an explicit override", async () => {
    const home = await mkdtemp(join(tmpdir(), "comitia-dogfood-home-"));
    const override = join(home, "custom-work");
    cleanups.push(() => rm(home, { recursive: true }));

    const result = runDogfoodLib(["resolve-work-dir"], {
      HOME: home,
      COMITIA_WORK_DIR: override,
      COMITIA_DOGFOOD_AGENT_NAME: "ミカ",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(override);
  });

  it("does not tell humans to export COMITIA_WORK_DIR in the default summary", async () => {
    const home = await mkdtemp(join(tmpdir(), "comitia-dogfood-home-"));
    const xdg = join(home, "xdg-data");
    cleanups.push(() => rm(home, { recursive: true }));
    await mkdir(join(home, ".comitia"), { recursive: true });
    await writeFile(
      join(home, ".comitia", "config.json"),
      `${JSON.stringify(
        {
          boardUrl: "http://127.0.0.1:8787",
          ownerToken: "comt_owner_test",
          agents: {
            ミカ: {
              agentId: "agent-1",
              token: "comt_agent_test",
              engine: "claude-code",
            },
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    const expected = namedWorkspacePath(
      comitiaWorkspaceId("ミカ"),
      { XDG_DATA_HOME: xdg, HOME: home },
      home,
    );

    const result = runDogfoodLib(["summary"], {
      HOME: home,
      XDG_DATA_HOME: xdg,
      COMITIA_DOGFOOD_BOARD_URL: "http://127.0.0.1:8787",
      COMITIA_DOGFOOD_AGENT_NAME: "ミカ",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Workspace:     ${expected} (enginebay named: comitia-ミカ)`);
    expect(result.stdout).toContain("COMITIA_WORK_DIR=(not set; named XDG workspace)");
    expect(result.stdout).toContain("node packages/agent/dist/cli.js agent connect ミカ");
    expect(result.stdout).not.toContain("export COMITIA_WORK_DIR=");
    expect(result.stdout).not.toContain(".comitia/work");
  });
});
