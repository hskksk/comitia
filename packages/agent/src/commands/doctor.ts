import { access, constants, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "../config.js";

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

  findings.push(await checkClaudeAvailability());

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
