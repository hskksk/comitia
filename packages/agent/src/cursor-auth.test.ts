import { lstat, mkdir, mkdtemp, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachHostCursorAuth,
  detectCursorAuthSource,
  hostCursorAuthJsonPath,
} from "./cursor-auth.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("detectCursorAuthSource", () => {
  it("prefers CURSOR_API_KEY over a login file", async () => {
    const hostHome = await tempDir("comitia-cursor-detect-key-");
    await mkdir(join(hostHome, ".cursor"), { recursive: true });
    await writeFile(
      hostCursorAuthJsonPath(hostHome),
      '{"dummy":true}\n',
      { mode: 0o600 },
    );
    expect(
      await detectCursorAuthSource(
        { CURSOR_API_KEY: "user-key" },
        hostHome,
        { keychainHasLogin: () => true },
      ),
    ).toEqual({ kind: "api-key" });
  });

  it("detects CURSOR_AUTH_TOKEN when no API key is set", async () => {
    const hostHome = await tempDir("comitia-cursor-detect-token-");
    expect(
      await detectCursorAuthSource(
        { CURSOR_AUTH_TOKEN: "user-token" },
        hostHome,
        { keychainHasLogin: () => false },
      ),
    ).toEqual({ kind: "auth-token" });
  });

  it("detects ~/.cursor/auth.json without reading its contents", async () => {
    const hostHome = await tempDir("comitia-cursor-detect-file-");
    await mkdir(join(hostHome, ".cursor"), { recursive: true });
    await writeFile(
      hostCursorAuthJsonPath(hostHome),
      '{"dummy":true}\n',
      { mode: 0o600 },
    );
    expect(
      await detectCursorAuthSource({}, hostHome, {
        keychainHasLogin: () => false,
      }),
    ).toEqual({ kind: "auth-file" });
  });

  it("detects a Keychain login when no file or env is present", async () => {
    const hostHome = await tempDir("comitia-cursor-detect-kc-");
    expect(
      await detectCursorAuthSource({}, hostHome, {
        keychainHasLogin: () => true,
      }),
    ).toEqual({ kind: "keychain" });
  });

  it("returns none when nothing is configured", async () => {
    const hostHome = await tempDir("comitia-cursor-detect-none-");
    expect(
      await detectCursorAuthSource({}, hostHome, {
        keychainHasLogin: () => false,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("attachHostCursorAuth", () => {
  it("symlinks the host auth file and does not copy it", async () => {
    const hostHome = await tempDir("comitia-cursor-attach-host-");
    const runtimeHome = await tempDir("comitia-cursor-attach-rt-");
    await mkdir(join(hostHome, ".cursor"), { recursive: true });
    const hostAuth = hostCursorAuthJsonPath(hostHome);
    await writeFile(hostAuth, '{"dummy":true}\n', { mode: 0o600 });

    await attachHostCursorAuth(runtimeHome, hostHome);

    const dest = hostCursorAuthJsonPath(runtimeHome);
    expect((await lstat(dest)).isSymbolicLink()).toBe(true);
    expect(await readlink(dest)).toBe(hostAuth);
    expect((await stat(dest)).ino).toBe((await stat(hostAuth)).ino);
  });

  it("is a no-op when the host has no auth.json", async () => {
    const hostHome = await tempDir("comitia-cursor-attach-empty-");
    const runtimeHome = await tempDir("comitia-cursor-attach-empty-rt-");
    await attachHostCursorAuth(runtimeHome, hostHome);
    await expect(stat(hostCursorAuthJsonPath(runtimeHome))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not replace an existing destination", async () => {
    const hostHome = await tempDir("comitia-cursor-attach-keep-");
    const runtimeHome = await tempDir("comitia-cursor-attach-keep-rt-");
    await mkdir(join(hostHome, ".cursor"), { recursive: true });
    await mkdir(join(runtimeHome, ".cursor"), { recursive: true });
    const hostAuth = hostCursorAuthJsonPath(hostHome);
    const dest = hostCursorAuthJsonPath(runtimeHome);
    await writeFile(hostAuth, '{"dummy":true}\n', { mode: 0o600 });
    await symlink("/tmp/already-attached", dest);

    await attachHostCursorAuth(runtimeHome, hostHome);
    expect(await readlink(dest)).toBe("/tmp/already-attached");
  });
});
