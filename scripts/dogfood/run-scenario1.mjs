#!/usr/bin/env node
/**
 * M5 シナリオ 1 を API + git/gh で実運転する（ミカの agent connect 不要）。
 *
 * Usage:
 *   pnpm dogfood:scenario1
 *   pnpm dogfood:scenario1 --skip-merge    # マージは人間が GitHub で実施
 *   pnpm dogfood:scenario1 --skip-git       # ボード操作のみ
 *   pnpm dogfood:scenario1 --pr-url URL --thread-id UUID   # PR 作成後に再開
 */
import { accessSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function log(...args) {
  console.error(...args);
}

function parseArgs(argv) {
  const result = {
    skipMerge: argv.includes("--skip-merge"),
    skipGit: argv.includes("--skip-git"),
    dryRun: argv.includes("--dry-run"),
    prUrl: null,
    threadId: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--pr-url" && argv[i + 1]) {
      result.prUrl = argv[++i];
    }
    if (argv[i] === "--thread-id" && argv[i + 1]) {
      result.threadId = argv[++i];
    }
  }
  return result;
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
    cwd: options.cwd,
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return (result.stdout ?? "").trim();
}

function tryRun(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: options.env ?? process.env,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function gitRoot() {
  return (
    process.env.COMITIA_DOGFOOD_GIT_ROOT ??
    join(homedir(), ".comitia", "scenario1-repo")
  );
}

function ensureGitClone(repoUrl) {
  const root = gitRoot();
  try {
    accessSync(join(root, ".git"));
    run("git", ["fetch", "origin"], { cwd: root });
    return root;
  } catch {
    mkdirSync(join(root, ".."), { recursive: true });
    run("git", ["clone", repoUrl, root]);
    return root;
  }
}

function createDocsBranch(repoUrl, baseBranch) {
  const root = ensureGitClone(repoUrl);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const branch = `cursor/m5-scenario1-${stamp}-66c9`;
  const markerPath = "docs/dogfood/scenario1-runs.md";
  const markerLine = `- ${new Date().toISOString()} M5 scenario1 automated run`;

  run("git", ["fetch", "origin", baseBranch], { cwd: root });
  run("git", ["checkout", "-B", branch, `origin/${baseBranch}`], { cwd: root });

  let content = "";
  const show = tryRun("git", ["show", `HEAD:${markerPath}`], { cwd: root });
  if (show.ok) {
    content = show.stdout;
  } else {
    content =
      "# M5 scenario1 runs\n\nAutomated dogfood markers (safe to revert).\n\n";
  }
  if (!content.includes(markerLine)) {
    content += `${markerLine}\n`;
  }
  run(
    "bash",
    ["-lc", `mkdir -p docs/dogfood && cat > '${markerPath}' <<'EOF'\n${content}EOF`],
    { cwd: root },
  );
  run("git", ["add", markerPath], { cwd: root });
  run("git", ["commit", "-m", `docs: M5 scenario1 dogfood marker (${stamp})`], {
    cwd: root,
  });
  run("git", ["push", "-u", "origin", branch], { cwd: root });
  return { root, branch, compareUrl: `https://github.com/hskksk/comitia/compare/${baseBranch}...${branch}?expand=1` };
}

function createPullRequest(branch, baseBranch) {
  const title = `dogfood: M5 scenario1 docs marker`;
  const body = "Automated M5 scenario1 dogfood run. Safe to merge and revert.";
  const attempts = [
    () =>
      tryRun("gh", [
        "pr",
        "create",
        "--repo",
        "hskksk/comitia",
        "--base",
        baseBranch,
        "--head",
        branch,
        "--title",
        title,
        "--body",
        body,
      ]),
    () =>
      tryRun(
        "gh",
        [
          "pr",
          "create",
          "--repo",
          "hskksk/comitia",
          "--base",
          baseBranch,
          "--head",
          branch,
          "--title",
          title,
          "--body",
          body,
        ],
        { env: { ...process.env, GH_TOKEN: undefined } },
      ),
  ];
  for (const attempt of attempts) {
    const result = attempt();
    if (result.ok) {
      const prUrl = result.stdout;
      const prNumber = Number(prUrl.match(/\/pull\/(\d+)/)?.[1]);
      if (prNumber) {
        return { prUrl, prNumber };
      }
    }
  }
  const listed = tryRun(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      "hskksk/comitia",
      "--head",
      branch,
      "--json",
      "number,url",
      "--jq",
      ".[0]",
    ],
    { env: { ...process.env, GH_TOKEN: undefined } },
  );
  if (listed.ok && listed.stdout) {
    const parsed = JSON.parse(listed.stdout);
    if (parsed?.url && parsed?.number) {
      return { prUrl: parsed.url, prNumber: parsed.number };
    }
  }
  return null;
}

async function waitForPrState(boardUrl, ownerToken, threadId, expected, attempts = 18) {
  for (let i = 0; i < attempts; i += 1) {
    await ownerFetch(boardUrl, ownerToken, "/v1/github/sync", {
      method: "POST",
      body: "{}",
    });
    const inbox = await ownerFetch(boardUrl, ownerToken, "/v1/inbox");
    const item = inbox.items.find((row) => row.threadId === threadId);
    const pr = item?.pullRequests?.[0];
    if (pr?.state === expected) {
      return pr;
    }
    if (i % 3 === 0) {
      log(`    waiting for PR state=${expected} (poll ${i + 1}/${attempts})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`PR state did not become ${expected} for thread ${threadId}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const boardUrl = (
    config.boardUrl ||
    process.env.COMITIA_DOGFOOD_BOARD_URL ||
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");
  const agentName = process.env.COMITIA_DOGFOOD_AGENT_NAME ?? "ミカ";
  const agent = config.agents?.[agentName];
  const ownerToken = config.ownerToken;
  const repoUrl =
    process.env.COMITIA_DOGFOOD_REPO_URL ?? "https://github.com/hskksk/comitia";
  const baseBranch = process.env.COMITIA_DOGFOOD_BASE_BRANCH ?? "m5-github-spec";

  if (!ownerToken || !agent?.token) {
    throw new Error(`~/.comitia/config.json に ownerToken と agents.${agentName} が必要です`);
  }

  const health = await fetch(`${boardUrl}/healthz`);
  if (!health.ok) {
    throw new Error(`board is not healthy at ${boardUrl}/healthz`);
  }

  let threadId = options.threadId;
  let prUrl = options.prUrl;
  let prNumber = prUrl ? Number(prUrl.match(/\/pull\/(\d+)/)?.[1]) : 0;

  if (!threadId) {
    log("==> Step 1: implementation スレッド作成");
    const created = await agentTool(boardUrl, agent.token, "create_thread", {
      type: "implementation",
      title: "M5 scenario1: docs marker 追記",
      trigger: "M5 dogfood 自動スクリプトによる最小 docs 変更",
      duplicateSearchQuery: "M5 scenario1 docs marker",
      consensusType: "owner_decision",
    });
    threadId = created.thread_id;
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
  } else {
    log(`==> Resume: thread_id=${threadId}`);
  }

  if (!prUrl && !options.skipGit) {
    log("==> Step 3: git で branch push + PR 作成");
    if (options.dryRun) {
      log("    dry-run: skipping git");
    } else {
      const git = createDocsBranch(repoUrl, baseBranch);
      log(`    branch=${git.branch}`);
      const pr = createPullRequest(git.branch, baseBranch);
      if (!pr) {
        log("");
        log("PR 自動作成に失敗しました。次を実行してください:");
        log(`  1. PR を作成: ${git.compareUrl}`);
        log(
          `  2. 再開: pnpm dogfood:scenario1 --thread-id ${threadId} --pr-url https://github.com/hskksk/comitia/pull/N`,
        );
        log("");
        throw new Error("PR creation failed — create PR manually and re-run with --pr-url");
      }
      prUrl = pr.prUrl;
      prNumber = pr.prNumber;
      log(`    PR #${prNumber} ${prUrl}`);
    }
  } else if (options.skipGit) {
    log("==> Step 3: skipped (--skip-git)");
  } else {
    log(`==> Step 3: resume PR ${prUrl}`);
  }

  if (prUrl && prNumber > 0) {
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
      log("==> Step 6: GitHub で PR マージ（失敗時は手動マージを待機）");
      const merged = tryRun("gh", [
        "pr",
        "merge",
        String(prNumber),
        "--squash",
        "--delete-branch",
        "--repo",
        "hskksk/comitia",
      ]);
      if (!merged.ok) {
        log("    gh pr merge failed — GitHub UI でマージしてください");
        log(`    ${prUrl}`);
      }

      log("==> Step 7: inbox でマージ済み確認");
      const mergedPr = await waitForPrState(
        boardUrl,
        ownerToken,
        threadId,
        "merged",
      );
      log(`    inbox OK: #${mergedPr.number} merged`);

      log("==> Step 8: complete_thread");
      await ownerFetch(boardUrl, ownerToken, `/v1/threads/${threadId}/declare`, {
        method: "POST",
        body: JSON.stringify({ kind: "complete_thread" }),
      });
      log("    thread completed");
    } else {
      log("==> Step 6-8: skipped (--skip-merge)");
      log(`    マージ後: pnpm dogfood:scenario1 --thread-id ${threadId} --pr-url ${prUrl}`);
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
