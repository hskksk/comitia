import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("board process entrypoint", () => {
  it("requires DATABASE_URL", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;

    const result = spawnSync(
      resolve(packageDir, "node_modules/.bin/tsx"),
      ["src/http/main.ts"],
      {
        cwd: packageDir,
        env,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is required");
  });
});
