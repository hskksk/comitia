import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function escapeGitConfigValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", " ").replaceAll("\t", " ");
}

export async function writeIsolatedGitconfig(
  gitconfigPath: string,
  input: { token: string; committerName: string },
): Promise<void> {
  const gitconfig = `[user]
	name = ${escapeGitConfigValue(input.committerName)}
	email = enginebay@users.noreply.github.com
[url "https://x-access-token:${input.token}@github.com/"]
	insteadOf = https://github.com/
	insteadOf = git@github.com:
`;
  await mkdir(dirname(gitconfigPath), { recursive: true });
  await writeFile(gitconfigPath, gitconfig, { mode: 0o600 });
}
