import { GateViolation } from "../domain/errors.js";

const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

export function parsePullRequestUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const match = PR_URL.exec(url.trim());
  if (!match) {
    throw new GateViolation("PR URL が不正です");
  }
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]),
  };
}
