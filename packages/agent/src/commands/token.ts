import { loadConfig } from "../config.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface TokenCommandOptions {
  configDir?: string;
  stdout?: CliOutput;
  stderr?: CliOutput;
}

export async function tokenCommand(
  options: TokenCommandOptions = {},
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const config = await loadConfig(options.configDir);
  if (!config.ownerToken) {
    throw new Error("オーナートークンがありません。`comitia init` を実行してください。");
  }
  if (stdout.isTTY) {
    stderr.write(
      "注意: オーナートークンは秘密情報です。共有したりログに残さないでください。\n",
    );
  }
  stdout.write(`${config.ownerToken}\n`);
}
