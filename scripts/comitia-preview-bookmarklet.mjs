#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(
  root,
  "docs/ops/comitia-preview-token-bookmarklet.js",
);
const source = readFileSync(sourcePath, "utf8");
const minified = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim();

const href = "javascript:" + encodeURI(minified);

console.log("Comitia preview token bookmarklet\n");
console.log("Drag this link to your bookmarks bar:\n");
console.log(`  <a href="${href}">Comitia PR token</a>\n`);
console.log("Raw javascript: URL (for manual bookmark creation):\n");
console.log(href);
