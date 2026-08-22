import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { devNull } from "node:os";

export type GithubSessionCredentials = {
  token: string;
  expiresAt: Date;
  owner: string;
  repo: string;
  repoUrl: string;
};

const GITHUB_TOKEN_ENV_KEYS = ["GH_TOKEN", "GITHUB_TOKEN"] as const;
export const GITHUB_TOKEN_REFRESH_MS = 10 * 60 * 1000;

export function githubAuthNeedsRefresh(
  creds: GithubSessionCredentials | null,
  now = Date.now(),
): boolean {
  if (!creds) {
    return false;
  }
  return creds.expiresAt.getTime() - now < GITHUB_TOKEN_REFRESH_MS;
}

export async function readJsonErrorMessage(
  response: Response,
): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error.length > 0
      ? body.error
      : null;
  } catch {
    return null;
  }
}

export async function fetchGithubCredentials(
  boardUrl: string,
  agentToken: string,
  projectId?: string,
): Promise<GithubSessionCredentials | null> {
  try {
    const response = await fetch(
      `${boardUrl.replace(/\/$/, "")}/v1/me/github-credentials`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify(projectId ? { projectId } : {}),
      },
    );
    if (!response.ok) {
      const detail = await readJsonErrorMessage(response);
      console.error(
        `[github-auth] POST /v1/me/github-credentials failed: ${response.status}${detail ? ` ${detail}` : ""}`,
      );
      return null;
    }
    const body = (await response.json()) as {
      token?: string;
      expiresAt?: string;
      owner?: string;
      repo?: string;
      repoUrl?: string;
    };
    if (
      typeof body.token !== "string" ||
      typeof body.expiresAt !== "string" ||
      typeof body.owner !== "string" ||
      typeof body.repo !== "string" ||
      typeof body.repoUrl !== "string"
    ) {
      console.error("[github-auth] POST /v1/me/github-credentials returned an incomplete payload");
      return null;
    }
    console.error(
      `[github-auth] minted installation token for ${body.owner}/${body.repo}`,
    );
    return {
      token: body.token,
      expiresAt: new Date(body.expiresAt),
      owner: body.owner,
      repo: body.repo,
      repoUrl: body.repoUrl,
    };
  } catch (error) {
    console.error(
      `[github-auth] POST /v1/me/github-credentials unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function githubAppGitExtraHeader(token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return `AUTHORIZATION: basic ${basic}`;
}

function gitEnvIgnoringHostConfig(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = engineGithubEnv(null, base);
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = devNull;
  return env;
}

export function gitEnvWithoutHostCredentials(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return gitEnvIgnoringHostConfig(base);
}

export function gitEnvWithToken(
  token: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = gitEnvIgnoringHostConfig(base);
  env.GIT_CONFIG_COUNT = "1";
  env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
  env.GIT_CONFIG_VALUE_0 = githubAppGitExtraHeader(token);
  return env;
}

export function engineGithubEnv(
  token: string | null,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  if (token) {
    env.GH_TOKEN = token;
    env.GITHUB_TOKEN = token;
    return env;
  }
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

export async function writeIsolatedGitHubAuth(
  home: string,
  input: { token: string; committerName: string },
): Promise<void> {
  const extraHeader = githubAppGitExtraHeader(input.token);
  const gitconfig = `[user]
	name = ${escapeGitConfigValue(input.committerName)}
	email = comitia-agent@users.noreply.github.com
[credential]
	helper =
[http "https://github.com/"]
	extraHeader = ${extraHeader}
[url "https://github.com/"]
	insteadOf = git@github.com:
	insteadOf = ssh://git@github.com/
`;
  await mkdir(home, { recursive: true });
  await writeFile(join(home, ".gitconfig"), gitconfig, { mode: 0o600 });
}

function escapeGitConfigValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", " ").replaceAll("\t", " ");
}
