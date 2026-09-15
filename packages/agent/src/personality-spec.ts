import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { PERSONALITY_PRESETS } from "@comitia/shared";

export function listPackagedPersonalityNames(): string[] {
  return PERSONALITY_PRESETS.map((preset) => preset.id);
}

export function formatPersonalityList(): string {
  return `${PERSONALITY_PRESETS.map((preset) => `${preset.id}\n${preset.body}`).join("\n\n")}\n`;
}

export function findPackagedPersonality(
  name: string,
): (typeof PERSONALITY_PRESETS)[number] | undefined {
  return PERSONALITY_PRESETS.find((preset) => preset.id === name);
}

export function unknownPersonalityMessage(spec: string): string {
  const names = listPackagedPersonalityNames().join("、");
  return `不明な性格: ${spec}。パッケージの例: ${names}。本文は \`comitia personality list\` で見られます。ファイルならパスと拡張子を指定してください。`;
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
  options: { cwd?: string } = {},
): string | null {
  if (spec === "") {
    return null;
  }
  if (looksLikePath(spec)) {
    if (!extname(spec)) {
      throw new Error(
        "性格ファイルは拡張子を省略できません（例: ./attitude.txt）。パッケージの例なら名前だけ指定してください",
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
  const preset = findPackagedPersonality(spec);
  if (!preset) {
    throw new Error(unknownPersonalityMessage(spec));
  }
  return preset.body;
}
