import { loadConfig } from "../config.js";
import { formatHttpError } from "../http-error.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface ProjectCommandOptions {
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: CliOutput;
}

export interface ProjectSetCommandOptions extends ProjectCommandOptions {
  repoUrl?: string;
  clearRepo: boolean;
}

type ProjectSummary = {
  name: string;
  repoUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  githubInstallationId: boolean;
};

async function requireOwnerHeaders(options: ProjectCommandOptions) {
  const config = await loadConfig(options.configDir);
  if (!config.boardUrl) {
    throw new Error("boardUrl が設定されていません。`comitia init` を実行してください。");
  }
  if (!config.ownerToken) {
    throw new Error("オーナートークンがありません。`comitia init` を実行してください。");
  }
  return {
    boardUrl: config.boardUrl,
    headers: { authorization: `Bearer ${config.ownerToken}` },
  };
}

function printSummary(stdout: CliOutput, summary: ProjectSummary): void {
  stdout.write(`プロジェクト: ${summary.name}\n`);
  stdout.write(`repoUrl: ${summary.repoUrl ?? "(未設定)"}\n`);
  stdout.write(
    `GitHub: ${
      summary.githubOwner && summary.githubRepo
        ? `${summary.githubOwner}/${summary.githubRepo}`
        : "(未設定)"
    }\n`,
  );
  stdout.write(`App インストール: ${summary.githubInstallationId ? "あり" : "なし"}\n`);
}

export async function projectCommand(
  options: ProjectCommandOptions = {},
): Promise<void> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const stdout = options.stdout ?? process.stdout;
  const { boardUrl, headers } = await requireOwnerHeaders(options);

  const res = await fetchFn(new URL("/v1/project", boardUrl), { headers });
  if (!res.ok) {
    throw new Error(await formatHttpError(res));
  }
  const summary = (await res.json()) as ProjectSummary;
  printSummary(stdout, summary);
}

export async function projectSetCommand(
  options: ProjectSetCommandOptions,
): Promise<void> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const stdout = options.stdout ?? process.stdout;
  const { boardUrl, headers } = await requireOwnerHeaders(options);

  const repoUrl =
    options.clearRepo || !options.repoUrl?.trim() ? null : options.repoUrl.trim();

  const res = await fetchFn(new URL("/v1/project", boardUrl), {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ repoUrl }),
  });
  if (!res.ok) {
    throw new Error(await formatHttpError(res));
  }
  const updated = (await res.json()) as {
    repoUrl: string | null;
    githubOwner: string | null;
    githubRepo: string | null;
  };
  stdout.write(
    updated.repoUrl
      ? `repoUrl を更新しました: ${updated.repoUrl}\n`
      : "repoUrl を空にしました\n",
  );
}
