import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { schema, startBoardServer } from "@comitia/board";
import { parseCliArgs, runCli } from "./cli.js";
import { initCommand } from "./commands/init.js";
import { projectCommand, projectSetCommand } from "./commands/project.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe("project CLI arg parsing", () => {
  it("parses `project` with no args", () => {
    expect(parseCliArgs(["project"])).toEqual({ command: "project" });
  });

  it("parses `project set --repo-url <url>`", () => {
    expect(
      parseCliArgs(["project", "set", "--repo-url", "https://github.com/a/b"]),
    ).toEqual({
      command: "project-set",
      repoUrl: "https://github.com/a/b",
      clearRepo: false,
    });
  });

  it("parses `project set --clear-repo`", () => {
    expect(parseCliArgs(["project", "set", "--clear-repo"])).toEqual({
      command: "project-set",
      repoUrl: undefined,
      clearRepo: true,
    });
  });

  it("throws when neither --repo-url nor --clear-repo is given", () => {
    expect(() => parseCliArgs(["project", "set"])).toThrow(/Usage/);
  });
});

async function setupServer() {
  const configDir = await mkdtemp(join(tmpdir(), "comitia-project-"));
  cleanups.push(() => rm(configDir, { recursive: true }));

  const client = new PGlite();
  cleanups.push(() => client.close());
  const db = drizzle(client, { schema });
  const here = dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: join(here, "../../board/drizzle") });
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

  return { configDir, boardUrl: server.baseUrl };
}

describe("project command integration", () => {
  it("sets the repo binding and reflects it via `comitia project`", async () => {
    const { configDir } = await setupServer();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk: Buffer | string) => chunks.push(String(chunk)));

    await projectSetCommand({
      configDir,
      stdout,
      repoUrl: "https://github.com/hskksk/comitia",
      clearRepo: false,
    });
    expect(chunks.join("")).toContain("https://github.com/hskksk/comitia");

    chunks.length = 0;
    await projectCommand({ configDir, stdout });
    expect(chunks.join("")).toContain("hskksk/comitia");
  });

  it("clears the repo binding via runCli", async () => {
    const { configDir } = await setupServer();
    await projectSetCommand({
      configDir,
      stdout: new PassThrough(),
      repoUrl: "https://github.com/hskksk/comitia",
      clearRepo: false,
    });

    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk: Buffer | string) => chunks.push(String(chunk)));
    await runCli(["project", "set", "--clear-repo"], { configDir, stdout });
    expect(chunks.join("")).toContain("空にしました");

    chunks.length = 0;
    await projectCommand({ configDir, stdout });
    expect(chunks.join("")).toContain("(未設定)");
  });
});
