#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("usage: sync-package-versions.mjs <version>");
  process.exit(1);
}

const root = join(import.meta.dirname, "..");
const packageJsonPaths = [
  join(root, "package.json"),
  ...readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, "packages", entry.name, "package.json")),
];

for (const path of packageJsonPaths) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log(`Synced package versions to ${version}`);
