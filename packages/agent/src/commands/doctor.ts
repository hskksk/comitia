import { access, constants, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, type ComitiaConfig } from "../config.js";
import { readJsonErrorMessage } from "../github-auth.js";

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
    if (response.status === 404 || response.status === 503) {
      return {
        ok: true,
        message:
          "GitHub 実行資格: 未接続（App 未設定か、プロジェクトに installation が無い）。git / gh はホスト環境に依存する",
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
