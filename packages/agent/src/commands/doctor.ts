import { access, constants, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, type ComitiaConfig } from "../config.js";
import { detectClaudeAuthSource, resolveHostHome } from "../claude-auth.js";
import { readJsonErrorMessage } from "../github-auth.js";
import { ownerAuthHeaders } from "../owner-headers.js";

const execFileAsync = promisify(execFile);

export interface DoctorFinding {
  ok: boolean;
  message: string;
}

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface DoctorCommandOptions {
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: CliOutput;
  env?: NodeJS.ProcessEnv;
  hostHome?: string;
}

function defaultConfigDir(): string {
  return join(homedir(), ".comitia");
}

async function checkClaudeAvailability(): Promise<DoctorFinding> {
  const candidates = ["claude", "claude-code"];
  for (const command of candidates) {
    try {
      await execFileAsync("which", [command]);
      return { ok: true, message: `${command} が PATH にあります` };
    } catch {
      // Try the next candidate.
    }
  }
  return {
    ok: false,
    message:
      "Claude Code CLI が見つかりません（PATH に claude がありません）。エージェント接続には必要です。",
  };
}

async function checkClaudeAuth(
  env: NodeJS.ProcessEnv,
  hostHome: string,
): Promise<DoctorFinding> {
  const source = await detectClaudeAuthSource(env, hostHome);
  if (source.kind === "api-key") {
    return {
      ok: true,
      message:
        "Claude 認証: ANTHROPIC_API_KEY が設定されています（claude login より優先）",
    };
  }
  if (source.kind === "oauth-token") {
    return {
      ok: true,
      message: "Claude 認証: CLAUDE_CODE_OAUTH_TOKEN が設定されています",
    };
  }
  if (source.kind === "credentials-file") {
    return {
      ok: true,
      message: "Claude 認証: ホストの claude login を引き継ぎます",
    };
  }
  return {
    ok: true,
    message:
      "Claude 認証: ホストの claude login（Keychain または ~/.claude/.credentials.json）を使う。未ログインなら `claude login`",
  };
}

async function checkProjectGithub(
  fetchFn: typeof globalThis.fetch,
  boardUrl: string,
  config: ComitiaConfig,
): Promise<DoctorFinding | null> {
  if (!config.ownerToken) {
    return null;
  }
  try {
    const response = await fetchFn(new URL("/v1/project", boardUrl), {
      headers: ownerAuthHeaders(config),
    });
    if (!response.ok) {
      if (response.status === 400) {
        return {
          ok: false,
          message:
            "GitHub App: 現在のプロジェクトを特定できない。`comitia project list` のあと `comitia project use <id>`",
        };
      }
      return null;
    }
    const body = (await response.json()) as {
      githubInstallationId?: string | null;
      githubOwner?: string | null;
      githubRepo?: string | null;
    };
    if (body.githubInstallationId && body.githubOwner && body.githubRepo) {
      return {
        ok: true,
        message: `GitHub App: 接続済み（${body.githubOwner}/${body.githubRepo}）`,
      };
    }
    return {
      ok: false,
      message:
        "GitHub App: プロジェクト未接続。App 権限を足しただけでは足りない。ボードのプロジェクト設定で「GitHub App を接続」する（`comitia project` でも確認できる）",
    };
  } catch {
    return null;
  }
}

async function checkGithubCredentials(
  fetchFn: typeof globalThis.fetch,
  boardUrl: string,
  config: ComitiaConfig,
): Promise<DoctorFinding> {
  const agent = Object.values(config.agents)[0];
  if (!agent) {
    return {
      ok: true,
      message: "GitHub 実行資格: エージェント未登録のためスキップ",
    };
  }
  try {
    const response = await fetchFn(new URL("/v1/me/github-credentials", boardUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agent.token}`,
      },
      body: JSON.stringify({}),
    });
    if (response.status === 200) {
      const body = (await response.json()) as {
        token?: string;
        owner?: string;
        repo?: string;
        expiresAt?: string;
      };
      const repo =
        body.owner && body.repo ? `${body.owner}/${body.repo}` : "repo";
      return {
        ok: true,
        message: `GitHub 実行資格: 発行できる（${repo}）`,
      };
    }
    if (response.status === 503) {
      return {
        ok: false,
        message:
          "GitHub 実行資格: ボードに GitHub App が設定されていない（GITHUB_APP_* 環境変数）。login では直らない",
      };
    }
    if (response.status === 404) {
      const detail = await readJsonErrorMessage(response);
      if (detail === "project has no repoUrl") {
        return {
          ok: false,
          message:
            "GitHub 実行資格: プロジェクトに repoUrl が無い。`comitia project set --repo-url` で付ける",
        };
      }
      return {
        ok: false,
        message:
          "GitHub 実行資格: プロジェクトに GitHub App が未接続。権限変更ではなく、ボードのプロジェクト設定で「GitHub App を接続」が必要",
      };
    }
    const detail = await readJsonErrorMessage(response);
    return {
      ok: false,
      message: `GitHub 実行資格: 発行に失敗（${response.status}${detail ? `: ${detail}` : ""}）`,
    };
  } catch {
    return {
      ok: false,
      message: "GitHub 実行資格: ボードに到達できません",
    };
  }
}

export async function doctorCommand(
  options: DoctorCommandOptions = {},
): Promise<void> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const stdout = options.stdout ?? process.stdout;
  const configDir = options.configDir ?? defaultConfigDir();
  const env = options.env ?? process.env;
  const hostHome = options.hostHome ?? resolveHostHome(env);
  const configPath = join(configDir, "config.json");
  const findings: DoctorFinding[] = [];

  try {
    await access(configPath, constants.F_OK);
    findings.push({ ok: true, message: `設定ファイル: ${configPath}` });
  } catch {
    findings.push({
      ok: false,
      message: `設定ファイルがありません: ${configPath}（\`comitia init\` を実行してください）`,
    });
  }

  try {
    const info = await stat(configPath);
    const mode = info.mode & 0o777;
    if (mode === 0o600) {
      findings.push({ ok: true, message: "設定ファイルのパーミッション: 0600" });
    } else {
      findings.push({
        ok: false,
        message: `設定ファイルのパーミッション: ${mode.toString(8)}（0600 を推奨）`,
      });
    }
  } catch {
    // Config missing; already reported.
  }

  const config = await loadConfig(configDir);
  if (config.boardUrl) {
    findings.push({
      ok: true,
      message: `boardUrl: ${config.boardUrl}`,
    });
    try {
      const health = await fetchFn(new URL("/healthz", config.boardUrl));
      if (health.ok) {
        findings.push({ ok: true, message: "ボード: 稼働中" });
        const projectGithub = await checkProjectGithub(
          fetchFn,
          config.boardUrl,
          config,
        );
        if (projectGithub) {
          findings.push(projectGithub);
        }
        findings.push(
          await checkGithubCredentials(fetchFn, config.boardUrl, config),
        );
      } else {
        findings.push({
          ok: false,
          message: `ボード: /healthz が失敗（${health.status}）`,
        });
      }
    } catch {
      findings.push({
        ok: false,
        message: "ボード: 到達できません",
      });
    }
  } else {
    findings.push({
      ok: false,
      message: "boardUrl が未設定です（`comitia init` を実行してください）",
    });
  }

  const engines = Object.values(config.agents).map((agent) => agent.engine);
  const needsClaude =
    engines.length === 0 || engines.includes("claude-code");
  if (needsClaude) {
    findings.push(await checkClaudeAvailability());
    findings.push(await checkClaudeAuth(env, hostHome));
  } else {
    findings.push({
      ok: true,
      message: "エンジン: fake（Claude Code CLI は不要）",
    });
  }

  stdout.write("Comitia doctor\n\n");
  for (const finding of findings) {
    stdout.write(`${finding.ok ? "✓" : "✗"} ${finding.message}\n`);
  }

  const boardDown = findings.some(
    (finding) =>
      !finding.ok &&
      (finding.message.includes("ボード") || finding.message.includes("boardUrl")),
  );
  if (boardDown) {
    stdout.write(
      "\nボードを起動するには（リポジトリルート）:\n  pnpm build && pnpm start\n  または: pnpm dogfood\n",
    );
  }
}
