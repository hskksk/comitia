#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const push = args.includes("--push");
const versionArg = args.find((arg) => arg !== "--push");
const version =
  versionArg ?? JSON.parse(readFileSync("package.json", "utf8")).version;
const image = process.env.DOCKER_IMAGE ?? "ghcr.io/hskksk/comitia";
const gitCommit = process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "";

const dockerArgs = [
  "buildx",
  "build",
  "-t",
  `${image}:${version}`,
  "-t",
  `${image}:latest`,
  "--build-arg",
  `COMITIA_VERSION=${version}`,
  "--build-arg",
  `GIT_COMMIT=${gitCommit}`,
  ".",
];

if (push) {
  dockerArgs.push("--push");
} else {
  dockerArgs.push("--load");
}

const result = spawnSync("docker", dockerArgs, { stdio: "inherit" });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Built ${image}:${version}${push ? " (pushed)" : ""}`);
