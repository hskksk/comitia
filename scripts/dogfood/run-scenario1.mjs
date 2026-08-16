#!/usr/bin/env node
/**
 * M5 シナリオ 1 を API + git/gh で実運転する（ミカの agent connect 不要）。
 *
 * Usage:
 *   node scripts/dogfood/run-scenario1.mjs
 *   node scripts/dogfood/run-scenario1.mjs --skip-merge
 *   node scripts/dogfood/run-scenario1.mjs --skip-git
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

function log(...args) {
  console.error(...args);
}

function parseArgs(argv) {
  return {
    skipMerge: argv.includes("--skip-merge"),
    skipGit: argv.includes("--skip-git"),
    dryRun: argv.includes("--dry-run"),
  };
}

async function loadConfig() {
  const path = join(homedir(), ".comitia", "config.json");
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

async function agentTool(boardUrl, agentToken, name, args) {
  const response = await fetch(`${boardUrl}/v1/tools/${name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${agentToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function ownerFetch(boardUrl, ownerToken, path, init = {}) {
  const response = await fetch(`${boardUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${ownerToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return (result.stdout ?? "").trim();
}

function gitRoot() {
  return process.env.COMITIA_DOGFOOD_GIT_ROOT ?? REPO_ROOT;
}

function createDocsBranchAndPr(title) {
  const root = gitRoot();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const branch = `dogfood/m5-scenario1-${stamp}`;
  const markerPath = "docs/dogfood/scenario1-runs.md";
  const markerLine = `- ${new Date().toISOString()} M5 scenario1 automated run (${title})`;

  run("git", ["fetch", "origin", "m5-github-spec"], { cwd: root });
  run("git", ["checkout", "-B", branch, "origin/m5-github-spec"], { cwd: root });

  let content = "";
  try {
    content = run("git", ["show", `HEAD:${markerPath}`], { cwd: root });
  } catch {
    content = "# M5 scenario1 runs\n\nAutomated dogfood markers (safe to revert).\n\n";
  }
  if (!content.includes(markerLine)) {
    content += `${markerLine}\n`;
  }
  run("bash", ["-lc", `mkdir -p docs/dogfood && cat > '${markerPath}' <<'EOF'\n${content}EOF`], {
    cwd: root,
  });
  run("git", ["add", markerPath], { cwd: root });
  run("git", ["commit", "-m", `docs: M5 scenario1 dogfood marker (${stamp})`], { cwd: root });
  run("git", ["push", "-u", "origin", branch], { cwd: root });

  const prUrl = run(
    "gh",
    [
      "pr",
      "create",
      "--base",
      "m5-github-spec",
      "--head",
      branch,
      "--title",
      `dogfood: M5 scenario1 docs marker (${stamp})`,
      "--body",
      "Automated M5 scenario1 dogfood run. Safe to merge and revert.",
    ],
    { cwd: root },
  );
  const prNumber = Number(prUrl.match(/\/pull\/(\d+)/)?.[1]);
  if (!prNumber) {
    throw new Error(`could not parse PR number from: ${prUrl}`);
  }
  return { branch, prUrl, prNumber };
}

async function waitForPrState(boardUrl, ownerToken, threadId, expected, attempts = 12) {
  for (let i = 0; i < attempts; i += 1) {
    await ownerFetch(boardUrl, ownerToken, "/v1/github/sync", { method: "POST", body: "{}" });
    const inbox = await ownerFetch(boardUrl, ownerToken, "/v1/inbox");
    const item = inbox.items.find((row) => row.threadId === threadId);
    const pr = item?.pullRequests?.[0];
    if (pr?.state === expected) {
      return pr;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`PR state did not become ${expected} for thread ${threadId}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const boardUrl = (config.boardUrl || process.env.COMITIA_DOGFOOD_BOARD_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const agentName = process.env.COMITIA_DOGFOOD_AGENT_NAME ?? "ミカ";
  const agent = config.agents?.[agentName];
  const ownerToken = config.ownerToken;

  if (!ownerToken || !agent?.token) {
    throw new Error(`~/.comitia/config.json に ownerToken と agents.${agentName} が必要です`);
  }

  const health = await fetch(`${boardUrl}/healthz`);
  if (!health.ok) {
    throw new Error(`board is not healthy at ${boardUrl}/healthz`);
  }

  log("==> Step 1: implementation スレッド作成");
  const created = await agentTool(boardUrl, agent.token, "create_thread", {
    type: "implementation",
    title: "M5 scenario1: docs marker 追記",
    trigger: "M5 dogfood 自動スクリプトによる最小 docs 変更",
    duplicateSearchQuery: "M5 scenario1 docs marker",
    consensusType: "owner_decision",
  });
  const threadId = created.thread_id;
  log(`    thread_id=${threadId}`);

  log("==> Step 2: 提案 → 候補選定 → owner_decide");
  const proposal = await agentTool(boardUrl, agent.token, "add_proposal", {
    thread_id: threadId,
    content: "docs/dogfood/scenario1-runs.md に実行マーカー行を 1 行追記する",
  });
  await agentTool(boardUrl, agent.token, "declare", {
    thread_id: threadId,
    kind: "select_candidate",
    payload: { proposalVersionId: proposal.proposal_version_id },
  });
  const decided = await agentTool(boardUrl, agent.token, "declare", {
    thread_id: threadId,
    kind: "owner_decide",
    payload: { binding: false, summary: "docs マーカー追記を採用" },
  });
  if (decided.state !== "decided") {
    throw new Error(`expected decided state, got ${decided.state}`);
  }
  log(`    state=${decided.state}`);

  let prUrl;
  let prNumber;
  if (options.skipGit) {
    prUrl = "https://github.com/hskksk/comitia/pull/0";
    prNumber = 0;
    log("==> Step 3: git/gh skipped (--skip-git)");
  } else {
    log("==> Step 3: git で docs PR 作成");
    if (options.dryRun) {
      log("    dry-run: skipping git push");
      prUrl = "https://github.com/hskksk/comitia/pull/0";
      prNumber = 0;
    } else {
      const pr = createDocsBranchAndPr("M5 scenario1 docs marker");
      prUrl = pr.prUrl;
      prNumber = pr.prNumber;
      log(`    PR #${prNumber} ${prUrl}`);
    }
  }

  if (!options.skipGit && prNumber > 0) {
    log("==> Step 4: link_pull_request");
    const linked = await agentTool(boardUrl, agent.token, "link_pull_request", {
      thread_id: threadId,
      url: prUrl,
    });
    log(`    linked #${linked.number} state=${linked.state}`);

    log("==> Step 5: inbox でオープン確認");
    const inboxOpen = await ownerFetch(boardUrl, ownerToken, "/v1/inbox");
    const openItem = inboxOpen.items.find((row) => row.threadId === threadId);
    if (!openItem?.pullRequests?.some((pr) => pr.state === "open")) {
      throw new Error("inbox にオープン PR が見つかりません");
    }
    log(`    inbox OK: #${openItem.pullRequests[0].number} open`);

    if (!options.skipMerge) {
      log("==> Step 6: GitHub で PR マージ");
      run("gh", ["pr", "merge", String(prNumber), "--squash", "--delete-branch"], {
        cwd: gitRoot(),
      });

      log("==> Step 7: inbox でマージ済み確認");
      const merged = await waitForPrState(boardUrl, ownerToken, threadId, "merged");
      log(`    inbox OK: #${merged.number} merged`);

      log("==> Step 8: complete_thread");
      await ownerFetch(boardUrl, ownerToken, `/v1/threads/${threadId}/declare`, {
        method: "POST",
        body: JSON.stringify({ kind: "complete_thread" }),
      });
      log("    thread completed");
    } else {
      log("==> Step 6-8: skipped (--skip-merge)");
    }
  }

  const summary = {
    ok: true,
    boardUrl,
    threadId,
    threadUrl: `${boardUrl}/threads/${threadId}`,
    inboxUrl: `${boardUrl}/inbox`,
    prUrl: prNumber > 0 ? prUrl : null,
    prNumber: prNumber > 0 ? prNumber : null,
    skippedMerge: options.skipMerge,
    skippedGit: options.skipGit,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
