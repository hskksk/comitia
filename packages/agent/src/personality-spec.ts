import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveAgentPackageRoot(fromUrl = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    const pkgFile = join(dir, "package.json");
    if (existsSync(pkgFile)) {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { name?: string };
      if (pkg.name === "@comitia/agent") {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Could not locate @comitia/agent package.json");
    }
    dir = parent;
  }
}

export function personalityResourcesDir(
  packageRoot = resolveAgentPackageRoot(),
): string {
  return join(packageRoot, "resources", "personality");
}

export function listPackagedPersonalityNames(
  dir = personalityResourcesDir(),
): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .map((name) => name.slice(0, -".txt".length))
    .sort((a, b) => a.localeCompare(b, "ja"));
}

function looksLikePath(spec: string): boolean {
  return (
    isAbsolute(spec) ||
    spec.startsWith(".") ||
    spec.includes("/") ||
    spec.includes("\\")
  );
}

function readUtf8Text(filePath: string): string {
  return readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
}

/**
 * `--personality` value:
 * - packaged resource: name only, no path, no extension (`慎重`)
 * - other file: path with extension (`./attitude.txt`)
 * - empty string: clear (null)
 */
export function resolvePersonalitySpec(
  spec: string,
  options: { cwd?: string; packageRoot?: string } = {},
): string | null {
  if (spec === "") {
    return null;
  }
  if (looksLikePath(spec)) {
    if (!extname(spec)) {
      throw new Error(
        "性格ファイルは拡張子を省略できません（例: ./attitude.txt）。パッケージ資源なら名前だけ指定してください",
      );
    }
    const cwd = options.cwd ?? process.cwd();
    const filePath = isAbsolute(spec) ? spec : resolve(cwd, spec);
    if (!existsSync(filePath)) {
      throw new Error(`性格ファイルが見つかりません: ${spec}`);
    }
    return readUtf8Text(filePath);
  }
  if (spec.includes(".")) {
    throw new Error(
      "パッケージの性格は名前だけ指定してください（拡張子なし）。ファイルならパスと拡張子を付けてください",
    );
  }
  const dir = resolve(
    personalityResourcesDir(options.packageRoot ?? resolveAgentPackageRoot()),
  );
  const filePath = resolve(dir, `${spec}.txt`);
  const prefix = dir.endsWith(sep) ? dir : `${dir}${sep}`;
  if (filePath !== dir && !filePath.startsWith(prefix)) {
    throw new Error("不正な性格名です");
  }
  if (!existsSync(filePath)) {
    const names = listPackagedPersonalityNames(dir).join("、");
    throw new Error(
      `不明な性格: ${spec}。パッケージ資源: ${names}。ファイルならパスと拡張子を指定してください。`,
    );
  }
  return readUtf8Text(filePath);
}
