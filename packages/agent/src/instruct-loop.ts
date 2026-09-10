import * as readline from "node:readline";
import { rm } from "node:fs/promises";
import { buildEnvironmentPrompt } from "./environment-prompt.js";
import {
  fetchGithubCredentials,
  gitEnvWithToken,
  gitEnvWithoutHostCredentials,
} from "./github-auth.js";
import type { EnginePlugin } from "./plugins/types.js";
import {
  ensureRepoCheckout,
  fetchIdentity,
  refreshGithubCredentials,
  resolveWorkDir,
  toEngineGithubAuth,
} from "./session-loop.js";

const FALLBACK_IDENTITY = {
  label: "エージェント",
  owner: null,
  project: null,
  projects: [],
  roles: [],
  personality: null,
};

export interface InstructLoopOptions {
  plugin: EnginePlugin;
  boardUrl: string;
  agentToken: string;
  workspaceId?: string;
  systemPrompt: boolean;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
}

export interface InstructLoopHandle {
  done: Promise<void>;
  stop: () => void;
}

export function instructConnectBanner(
  name: string,
  systemPrompt: boolean,
): string {
  const lines = [
    `${name} を指示モードで接続しています。行を入力して Enter。空行は無視。Ctrl-D で終了。Ctrl-C で切断します。`,
  ];
  if (systemPrompt) {
    lines.push("既定のシステムプロンプト（環境とツール解説）を渡します。");
  }
  return `${lines.join("\n")}\n`;
}

/** Start the engine, then run each stdin line as plugin.run. No session loop. */
export async function startInstructLoop(
  options: InstructLoopOptions,
): Promise<InstructLoopHandle> {
  const {
    plugin,
    boardUrl,
    agentToken,
    workspaceId,
    systemPrompt,
    stdin,
    stdout,
  } = options;

  const { path: workDir, persistent: keepWorkDir } =
    await resolveWorkDir(workspaceId);
  const identity = await fetchIdentity(boardUrl, agentToken);
  const repoUrls = [
    ...new Set(
      (identity?.projects ?? [])
        .map((row) => row.repoUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ];
  const repoUrl =
    repoUrls.length === 1 ? repoUrls[0]! : identity?.project?.repoUrl ?? null;
  const committerName = identity?.label ?? "エージェント";
  let githubCreds = await fetchGithubCredentials(boardUrl, agentToken);
  if (repoUrl) {
    const checkout = ensureRepoCheckout(
      workDir,
      repoUrl,
      githubCreds
        ? gitEnvWithToken(githubCreds.token)
        : gitEnvWithoutHostCredentials(),
    );
    if (!checkout.ok) {
      const note = githubCreds
        ? `[work-dir] repoUrl のクローン/更新に失敗: ${checkout.error}。作業ディレクトリの中身無しで続行する。`
        : `[work-dir] repoUrl のクローン/更新に失敗: ${checkout.error}。GitHub 実行資格が無い（プロジェクトに App 未接続のことが多い）。ホストの GH_TOKEN は使わない。作業ディレクトリの中身無しで続行する。`;
      console.error(note);
    }
  }

  await plugin.start({
    sessionId: "instruct",
    workDir,
    workDirPersistent: keepWorkDir,
    environmentPrompt: systemPrompt
      ? buildEnvironmentPrompt(identity ?? FALLBACK_IDENTITY)
      : "",
    github: githubCreds
      ? toEngineGithubAuth(githubCreds, committerName)
      : null,
    mcp: {
      command: process.execPath,
      args: [],
      env: {
        COMITIA_BOARD_URL: boardUrl,
        COMITIA_AGENT_TOKEN: agentToken,
      },
    },
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let stopped = false;
  const done = (async () => {
    let runIndex = 0;
    try {
      stdout.write("> ");
      for await (const line of rl) {
        if (stopped) {
          break;
        }
        const text = line.trim();
        if (!text) {
          stdout.write("> ");
          continue;
        }
        const refreshed = await refreshGithubCredentials(
          boardUrl,
          agentToken,
          githubCreds,
        );
        if (refreshed && refreshed.token !== githubCreds?.token) {
          githubCreds = refreshed;
          await plugin.updateGithubAuth?.(
            toEngineGithubAuth(githubCreds, committerName),
          );
        }
        runIndex += 1;
        try {
          await plugin.run(text, { run: runIndex });
        } catch (error: unknown) {
          console.error(error);
        }
        if (!stopped) {
          stdout.write("> ");
        }
      }
    } finally {
      rl.close();
      await plugin.stop();
      if (!keepWorkDir) {
        await rm(workDir, { recursive: true, force: true });
      }
    }
  })();

  return {
    done,
    stop: () => {
      stopped = true;
      rl.close();
    },
  };
}
