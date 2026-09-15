import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PERSONALITY_PRESETS } from "@comitia/shared";
import {
  findPackagedPersonality,
  formatPersonalityList,
  listPackagedPersonalityNames,
  resolvePersonalitySpec,
  unknownPersonalityMessage,
} from "./personality-spec.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe("resolvePersonalitySpec", () => {
  it("loads packaged examples from shared by name", () => {
    expect(listPackagedPersonalityNames()).toEqual(
      PERSONALITY_PRESETS.map((preset) => preset.id),
    );
    for (const preset of PERSONALITY_PRESETS) {
      expect(findPackagedPersonality(preset.id)?.body).toBe(preset.body);
      expect(resolvePersonalitySpec(preset.id)).toBe(preset.body);
    }
  });

  it("clears when the spec is empty", () => {
    expect(resolvePersonalitySpec("")).toBeNull();
  });

  it("reads a file only when the path includes an extension", async () => {
    const dir = await mkdtemp(join(tmpdir(), "comitia-personality-"));
    cleanups.push(() => rm(dir, { recursive: true }));
    const filePath = join(dir, "attitude.txt");
    await writeFile(filePath, "  独自の態度  \n", "utf8");
    expect(resolvePersonalitySpec(filePath)).toBe("独自の態度");
    expect(resolvePersonalitySpec(`./attitude.txt`, { cwd: dir })).toBe(
      "独自の態度",
    );
  });

  it("rejects a path without an extension", async () => {
    const dir = await mkdtemp(join(tmpdir(), "comitia-personality-"));
    cleanups.push(() => rm(dir, { recursive: true }));
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "nested", "attitude.txt"), "独自の態度\n", "utf8");
    expect(() =>
      resolvePersonalitySpec("./nested/attitude", { cwd: dir }),
    ).toThrow("拡張子を省略できません");
  });

  it("rejects a packaged name that looks like a filename", () => {
    expect(() => resolvePersonalitySpec("慎重.txt")).toThrow("名前だけ");
  });

  it("lists packaged names and personality list when the resource is missing", () => {
    expect(() => resolvePersonalitySpec("存在しない")).toThrow(
      unknownPersonalityMessage("存在しない"),
    );
    expect(() => resolvePersonalitySpec("存在しない")).toThrow("慎重");
    expect(() => resolvePersonalitySpec("存在しない")).toThrow(
      "comitia personality list",
    );
  });

  it("formats the packaged list as name then body", () => {
    const listed = formatPersonalityList();
    expect(listed.startsWith("慎重\n")).toBe(true);
    expect(listed).toContain(PERSONALITY_PRESETS[0]!.body);
    expect(listed).toContain("\n\n対立保持\n");
  });
});
