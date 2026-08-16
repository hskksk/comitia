import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { schema, startBoardServer } from "@comitia/board";
import { parseCliArgs } from "./cli.js";
import { loadConfig } from "./config.js";
import { initCommand } from "./commands/init.js";
import { registerCommand } from "./commands/register.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe("init and agent register commands", () => {
  it("parses init and agent register arguments", () => {
    expect(
      parseCliArgs([
        "init",
        "--board-url",
        "http://localhost:3000",
        "--name",
        "ハル",
        "--project",
        "comitia",
        "--repo-url",
        "https://github.com/hskksk/comitia",
      ]),
    ).toEqual({
      command: "init",
      boardUrl: "http://localhost:3000",
      name: "ハル",
      project: "comitia",
      repoUrl: "https://github.com/hskksk/comitia",
    });
    expect(
      parseCliArgs([
        "agent",
        "register",
        "--engine",
        "claude-code",
        "--name",
        "mika",
      ]),
    ).toEqual({
      command: "agent-register",
      engine: "claude-code",
      name: "mika",
    });
  });


  it("parses agent connect arguments", () => {
    expect(parseCliArgs(["agent", "connect", "mika"])).toEqual({
      command: "agent-connect",
      name: "mika",
    });
  });

  it("rejects unknown subcommands", () => {
    expect(() => parseCliArgs(["agent", "connect"])).toThrow(
      "Unknown command",
    );
  });

  it("initializes a project and registers an agent", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));

    const client = new PGlite();
    cleanups.push(() => client.close());
    const db = drizzle(client, { schema });
    const here = dirname(fileURLToPath(import.meta.url));
    await migrate(db, {
      migrationsFolder: join(here, "../../board/drizzle"),
    });
    const server = await startBoardServer({
      db: db as unknown as Parameters<typeof startBoardServer>[0]["db"],
      port: 0,
    });
    cleanups.push(() => server.close());

    await initCommand({
      boardUrl: server.baseUrl,
      name: "ハル",
      project: "comitia",
      configDir,
    });
    const config = await loadConfig(configDir);
    expect(config.ownerToken).toMatch(/^comt_/);
    expect(config.ownerId).toBeTruthy();
    expect(config.projectId).toBeTruthy();

    await registerCommand({
      name: "mika",
      engine: "claude-code",
      configDir,
    });
    const registered = await loadConfig(configDir);
    expect(registered.agents.mika?.agentId).toBeTruthy();
    expect(registered.agents.mika?.token).toMatch(/^comt_/);
    expect(registered.agents.mika?.engine).toBe("claude-code");
  });

  it("rejects unsupported engines before making a request", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "comitia-agent-"));
    cleanups.push(() => rm(configDir, { recursive: true }));

    await expect(
      registerCommand({
        name: "mika",
        engine: "other",
        configDir,
      }),
    ).rejects.toThrow("Unsupported engine");
  });
});
