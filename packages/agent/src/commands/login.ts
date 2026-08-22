import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, saveConfig } from "../config.js";
import { formatHttpError } from "../http-error.js";
import {
  buildOAuthStartUrl,
  startOAuthCallbackServer,
  type OAuthCallbackServer,
} from "../oauth-callback.js";

const execFileAsync = promisify(execFile);

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface LoginCommandOptions {
  boardUrl?: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: CliOutput;
  stderr?: CliOutput;
  noOpen?: boolean;
  openBrowser?: (url: string) => Promise<void>;
  startCallbackServer?: () => Promise<OAuthCallbackServer>;
}

async function defaultOpenBrowser(url: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url]);
    return;
  }
  await execFileAsync("xdg-open", [url]);
}

async function resolveBoardUrl(
  options: LoginCommandOptions,
): Promise<string> {
  const boardUrl = options.boardUrl ?? (await loadConfig(options.configDir)).boardUrl;
  if (!boardUrl) {
    throw new Error(
      "boardUrl が未設定です。`--board-url` を指定するか、`comitia init` を実行してください。",
    );
  }
  return boardUrl;
}

export async function loginCommand(
  options: LoginCommandOptions = {},
): Promise<void> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const boardUrl = await resolveBoardUrl(options);

  const configRes = await fetchFn(new URL("/v1/auth/config", boardUrl));
  if (!configRes.ok) {
    throw new Error(await formatHttpError(configRes));
  }
  const authConfig = (await configRes.json()) as { githubOAuth?: boolean };
  if (!authConfig.githubOAuth) {
    throw new Error(
      "このボードでは GitHub OAuth が有効ではありません。`comitia init` のトークンを `~/.comitia/config.json` に設定してください。",
    );
  }

  const callbackServer =
    await (options.startCallbackServer ?? startOAuthCallbackServer)();
  try {
    const authUrl = buildOAuthStartUrl(boardUrl, callbackServer.callbackOrigin);
    if (options.noOpen) {
      stdout.write(
        `ブラウザで次の URL を開いて GitHub ログインしてください:\n${authUrl}\n`,
      );
    } else {
      stdout.write("ブラウザで GitHub ログインを開いています…\n");
      try {
        await (options.openBrowser ?? defaultOpenBrowser)(authUrl);
      } catch {
        stdout.write(
          `ブラウザを自動で開けませんでした。次の URL を手動で開いてください:\n${authUrl}\n`,
        );
      }
    }

    const token = await callbackServer.waitForToken();
    const headers = { authorization: `Bearer ${token}` };
    const meRes = await fetchFn(new URL("/v1/me", boardUrl), { headers });
    if (!meRes.ok) {
      throw new Error(await formatHttpError(meRes));
    }
    const me = (await meRes.json()) as {
      participant: { id: string; displayName: string };
      projectId: string | null;
    };

    const existing = await loadConfig(options.configDir);
    await saveConfig(options.configDir, {
      ...existing,
      boardUrl,
      ownerToken: token,
      ownerId: me.participant.id,
      projectId: me.projectId ?? existing.projectId,
      agents: existing.agents,
    });

    if (stderr.isTTY) {
      stderr.write(
        "注意: オーナートークンは秘密情報です。共有したりログに残さないでください。\n",
      );
    }
    stdout.write(
      `ログインしました: ${me.participant.displayName} (${boardUrl})\n`,
    );
    if (me.projectId) {
      stdout.write(`現在のプロジェクト ID: ${me.projectId}\n`);
    }
  } finally {
    callbackServer.close();
  }
}
