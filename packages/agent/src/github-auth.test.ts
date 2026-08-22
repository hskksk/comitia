import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  engineGithubEnv,
  fetchGithubCredentials,
  gitEnvWithToken,
  writeIsolatedGitHubAuth,
} from "./github-auth.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe("engineGithubEnv", () => {
  it("overrides a host GH_TOKEN with the minted token", () => {
    const env = engineGithubEnv("ghs_minted", {
      GH_TOKEN: "github_pat_host",
      GITHUB_TOKEN: "host-other",
      PATH: "/bin",
    });
    expect(env.GH_TOKEN).toBe("ghs_minted");
    expect(env.GITHUB_TOKEN).toBe("ghs_minted");
    expect(env.PATH).toBe("/bin");
  });

  it("removes host GitHub tokens when minting failed", () => {
    const env = engineGithubEnv(null, {
      GH_TOKEN: "github_pat_host",
      GITHUB_TOKEN: "host-other",
      PATH: "/bin",
    });
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });
});

describe("gitEnvWithToken", () => {
  it("sets a GitHub Authorization extraHeader without dropping PATH", () => {
    const env = gitEnvWithToken("ghs_minted", { PATH: "/bin" });
    expect(env.PATH).toBe("/bin");
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraHeader");
    expect(env.GIT_CONFIG_VALUE_0).toBe("Authorization: Bearer ghs_minted");
  });
});

describe("writeIsolatedGitHubAuth", () => {
  it("writes insteadOf and committer identity into the isolated HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "comitia-gh-home-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    await writeIsolatedGitHubAuth(home, {
      token: "ghs_minted",
      committerName: "ウォーカー@ハル",
    });
    const gitconfig = await readFile(join(home, ".gitconfig"), "utf8");
    expect(gitconfig).toContain("name = ウォーカー@ハル");
    expect(gitconfig).toContain("email = comitia-agent@users.noreply.github.com");
    expect(gitconfig).toContain(
      'url "https://x-access-token:ghs_minted@github.com/"',
    );
    expect(gitconfig).toContain("insteadOf = https://github.com/");
  });
});

describe("fetchGithubCredentials", () => {
  it("returns credentials on 200", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          token: "ghs_minted",
          expiresAt: "2026-08-22T10:00:00.000Z",
          owner: "hskksk",
          repo: "comitia",
          repoUrl: "https://github.com/hskksk/comitia",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const creds = await fetchGithubCredentials("http://board.test", "agent-token");
    expect(creds).toEqual({
      token: "ghs_minted",
      expiresAt: new Date("2026-08-22T10:00:00.000Z"),
      owner: "hskksk",
      repo: "comitia",
      repoUrl: "https://github.com/hskksk/comitia",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://board.test/v1/me/github-credentials",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer agent-token",
        }),
      }),
    );
  });

  it("returns null on 404 without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 404 })),
    );
    await expect(
      fetchGithubCredentials("http://board.test", "agent-token"),
    ).resolves.toBeNull();
  });
});
