import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type GithubSessionCredentials = {
  token: string;
  expiresAt: Date;
  owner: string;
  repo: string;
  repoUrl: string;
};

const GITHUB_TOKEN_ENV_KEYS = ["GH_TOKEN", "GITHUB_TOKEN"] as const;

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
      console.error(
        `[github-auth] POST /v1/me/github-credentials failed: ${response.status}`,
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

export function gitEnvWithToken(
  token: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
  };
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
  const gitconfig = `[user]
	name = ${escapeGitConfigValue(input.committerName)}
	email = comitia-agent@users.noreply.github.com
[url "https://x-access-token:${input.token}@github.com/"]
	insteadOf = https://github.com/
	insteadOf = git@github.com:
`;
  await mkdir(home, { recursive: true });
  await writeFile(join(home, ".gitconfig"), gitconfig, { mode: 0o600 });
}

function escapeGitConfigValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", " ").replaceAll("\t", " ");
}
