import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveClaudeSecureStoragePin,
  resolveHostClaudeCredentialsDir,
  seedIsolatedClaudeAuth,
  detectClaudeAuthSource,
} from "./claude-auth.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe("resolveClaudeSecureStoragePin", () => {
  it("pins the default store with an empty string when the host has no override", () => {
    expect(resolveClaudeSecureStoragePin({ PATH: "/bin" })).toBe("");
  });

  it("keeps an explicit host CLAUDE_SECURESTORAGE_CONFIG_DIR, including empty", () => {
    expect(
      resolveClaudeSecureStoragePin({
        CLAUDE_SECURESTORAGE_CONFIG_DIR: "/custom-store",
      }),
    ).toBe("/custom-store");
    expect(
      resolveClaudeSecureStoragePin({ CLAUDE_SECURESTORAGE_CONFIG_DIR: "" }),
    ).toBe("");
  });

  it("passes a host CLAUDE_CONFIG_DIR through verbatim", () => {
    expect(
      resolveClaudeSecureStoragePin({
        CLAUDE_CONFIG_DIR: "~/.claude-work",
      }),
    ).toBe("~/.claude-work");
  });
});

describe("resolveHostClaudeCredentialsDir", () => {
  it("uses ~/.claude for the default store", () => {
    expect(resolveHostClaudeCredentialsDir({ PATH: "/bin" }, "/Users/haru")).toBe(
      "/Users/haru/.claude",
    );
  });

  it("follows CLAUDE_CONFIG_DIR when secure storage is unset", () => {
    expect(
      resolveHostClaudeCredentialsDir(
        { CLAUDE_CONFIG_DIR: "/host/.claude-work" },
        "/Users/haru",
      ),
    ).toBe("/host/.claude-work");
  });

  it("uses ~/.claude when secure storage is explicitly pinned to default", () => {
    expect(
      resolveHostClaudeCredentialsDir(
        {
          CLAUDE_CONFIG_DIR: "/host/.claude-work",
          CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
        },
        "/Users/haru",
      ),
    ).toBe("/Users/haru/.claude");
  });
});

describe("seedIsolatedClaudeAuth", () => {
  it("copies credentials and oauth session without host MCP servers or plugins", async () => {
    const hostHome = join(tmpdir(), `comitia-host-home-${Date.now()}`);
    const isolatedHome = join(tmpdir(), `comitia-isolated-home-${Date.now()}`);
    cleanups.push(() => rm(hostHome, { recursive: true, force: true }));
    cleanups.push(() => rm(isolatedHome, { recursive: true, force: true }));

    await mkdir(join(hostHome, ".claude", "plugins"), { recursive: true });
    await writeFile(
      join(hostHome, ".claude", ".credentials.json"),
      '{"claudeAiOauth":{"accessToken":"sk-ant-oat-host"}}',
      { mode: 0o600 },
    );
    await writeFile(
      join(hostHome, ".claude", "plugins", "extra.json"),
      '{"keep":false}',
    );
    await writeFile(
      join(hostHome, ".claude.json"),
      JSON.stringify({
        hasCompletedOnboarding: true,
        oauthAccount: { emailAddress: "haru@example.com" },
        mcpServers: { personal: { command: "npx" } },
      }),
    );

    await seedIsolatedClaudeAuth(isolatedHome, {
      env: {},
      hostHome,
    });

    expect(
      await readFile(join(isolatedHome, ".claude", ".credentials.json"), "utf8"),
    ).toContain("sk-ant-oat-host");
    expect(
      (await stat(join(isolatedHome, ".claude", ".credentials.json"))).mode & 0o777,
    ).toBe(0o600);
    const copiedJson = JSON.parse(
      await readFile(join(isolatedHome, ".claude.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(copiedJson.hasCompletedOnboarding).toBe(true);
    expect(copiedJson.oauthAccount).toEqual({
      emailAddress: "haru@example.com",
    });
    expect(copiedJson.mcpServers).toBeUndefined();
    await expect(
      readFile(join(isolatedHome, ".claude", "plugins", "extra.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(hostHome, ".claude.json"), "utf8"))).toMatchObject({
      mcpServers: { personal: { command: "npx" } },
    });
  });

  it("copies credentials from a host CLAUDE_CONFIG_DIR", async () => {
    const hostHome = join(tmpdir(), `comitia-host-profile-${Date.now()}`);
    const profileDir = join(hostHome, ".claude-work");
    const isolatedHome = join(tmpdir(), `comitia-isolated-profile-${Date.now()}`);
    cleanups.push(() => rm(hostHome, { recursive: true, force: true }));
    cleanups.push(() => rm(isolatedHome, { recursive: true, force: true }));
    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, ".credentials.json"),
      '{"claudeAiOauth":{"accessToken":"from-profile"}}',
      { mode: 0o600 },
    );

    await seedIsolatedClaudeAuth(isolatedHome, {
      env: { CLAUDE_CONFIG_DIR: profileDir },
      hostHome,
    });

    expect(
      await readFile(join(isolatedHome, ".claude", ".credentials.json"), "utf8"),
    ).toContain("from-profile");
  });

  it("is a no-op when the host has no Claude login files", async () => {
    const hostHome = join(tmpdir(), `comitia-host-empty-${Date.now()}`);
    const isolatedHome = join(tmpdir(), `comitia-isolated-empty-${Date.now()}`);
    cleanups.push(() => rm(hostHome, { recursive: true, force: true }));
    cleanups.push(() => rm(isolatedHome, { recursive: true, force: true }));
    await mkdir(hostHome, { recursive: true });

    await seedIsolatedClaudeAuth(isolatedHome, { env: {}, hostHome });

    await expect(
      readFile(join(isolatedHome, ".claude", ".credentials.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(isolatedHome, ".claude.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("detectClaudeAuthSource", () => {
  it("prefers ANTHROPIC_API_KEY over a credentials file", async () => {
    expect(
      await detectClaudeAuthSource(
        { ANTHROPIC_API_KEY: "sk-ant-api", PATH: "/bin" },
        "/missing-home",
      ),
    ).toEqual({ kind: "api-key" });
  });

  it("detects a host credentials file", async () => {
    const hostHome = join(tmpdir(), `comitia-detect-home-${Date.now()}`);
    cleanups.push(() => rm(hostHome, { recursive: true, force: true }));
    await mkdir(join(hostHome, ".claude"), { recursive: true });
    await writeFile(
      join(hostHome, ".claude", ".credentials.json"),
      "{}",
      { mode: 0o600 },
    );
    expect(await detectClaudeAuthSource({}, hostHome)).toEqual({
      kind: "credentials-file",
    });
  });
});
