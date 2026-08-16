#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = join(homedir(), ".comitia", "config.json");

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveConfig(config) {
  await mkdir(join(homedir(), ".comitia"), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function boardHasHumanOwner(databaseUrl) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    "psql",
    [
      databaseUrl,
      "-tAc",
      "SELECT count(*) FROM participants WHERE kind='human'",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return false;
  }
  return Number(result.stdout.trim()) > 0;
}

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

async function runBoardOctokit(script) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: join(REPO_ROOT, "packages/board"),
      env: process.env,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

export async function fetchGitHubAppSlug() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !privateKey) {
    return null;
  }
  return runBoardOctokit(`
import { App } from '@octokit/app';
const app = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\\\n/g, '\\n'),
});
const { data } = await app.octokit.request('GET /app');
console.log(data.slug ?? '');
`);
}

export async function fetchInstallationId(owner, repo) {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !privateKey) {
    return null;
  }
  const output = await runBoardOctokit(`
import { App } from '@octokit/app';
const app = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\\\n/g, '\\n'),
});
try {
  const { data } = await app.octokit.request('GET /repos/${owner}/${repo}/installation');
  console.log(String(data.id));
} catch {
  // not installed
}
`);
  return output || null;
}

export async function runInit(boardUrl, { ownerName, projectName, repoUrl }) {
  const response = await fetch(`${boardUrl}/v1/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerDisplayName: ownerName,
      projectName: projectName,
      repoUrl,
    }),
  });
  if (!response.ok) {
    throw new Error(`init failed: ${response.status} ${await response.text()}`);
  }
  const result = await response.json();
  await saveConfig({
    boardUrl,
    ownerId: result.ownerId,
    projectId: result.projectId,
    ownerToken: result.ownerToken,
    agents: {},
  });
  return result;
}

export async function registerAgent(boardUrl, ownerToken, name) {
  const response = await fetch(`${boardUrl}/v1/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ownerToken}`,
    },
    body: JSON.stringify({ displayName: name, engine: "claude-code" }),
  });
  if (!response.ok) {
    throw new Error(
      `agent register failed: ${response.status} ${await response.text()}`,
    );
  }
  const result = await response.json();
  const config = (await loadConfig()) ?? { boardUrl, agents: {} };
  config.boardUrl = boardUrl;
  config.ownerToken = ownerToken;
  config.projectId = result.projectId;
  config.agents[name] = {
    agentId: result.agentId,
    token: result.agentToken,
    engine: "claude-code",
  };
  await saveConfig(config);
  return result;
}

export async function connectGitHubInstallation(boardUrl, ownerToken, installationId) {
  const url = new URL("/v1/github/setup", boardUrl);
  url.searchParams.set("installation_id", installationId);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${ownerToken}` },
    redirect: "manual",
  });
  return response.status === 302 || response.status === 200;
}

function maskSecret(name, value) {
  if (!value) {
    return "(not set)";
  }
  if (name.includes("KEY") || name.includes("SECRET") || name.includes("TOKEN") || name === "DATABASE_URL") {
    return "***";
  }
  return value;
}

export function parseRepoOwnerRepo(repoUrl) {
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

export async function printSummary(input) {
  const config = await loadConfig();
  const lines = [];
  lines.push("");
  lines.push("=== Comitia M5 Dogfood ===");
  lines.push("");
  lines.push(`Board URL:     ${input.boardUrl}`);
  lines.push(`Login UI:      ${input.boardUrl}/login`);
  lines.push(`Health:        ${input.boardUrl}/healthz`);
  lines.push(`Inbox:         ${input.boardUrl}/inbox`);
  lines.push(`Config file:   ${CONFIG_PATH}`);
  lines.push("");

  if (config?.ownerToken) {
    lines.push("--- Owner (human) ---");
    lines.push(`Owner token:   ${config.ownerToken}`);
    lines.push(`Owner ID:      ${config.ownerId ?? "(unknown)"}`);
    lines.push(`Project ID:    ${config.projectId ?? "(unknown)"}`);
    lines.push("");
  } else {
    lines.push("Owner token:   (not initialized)");
    lines.push("");
  }

  const agentName = input.agentName ?? "ミカ";
  const agent = config?.agents?.[agentName];
  if (agent) {
    lines.push(`--- Agent (${agentName}) ---`);
    lines.push(`Agent token:   ${agent.token}`);
    lines.push(`Agent ID:      ${agent.agentId}`);
    lines.push(`Connect:`);
    lines.push(
      `  export PATH="$HOME/.local/bin:$PATH"`,
    );
    lines.push(
      `  export COMITIA_WORK_DIR="${input.workDir}"`,
    );
    lines.push(
      `  node packages/agent/dist/cli.js agent connect ${agentName}`,
    );
    lines.push("");
  } else {
    lines.push(`Agent ${agentName}: (not registered — run init flow again or register manually)`);
    lines.push("");
  }

  lines.push("--- tmux ---");
  for (const session of input.tmuxSessions ?? []) {
    lines.push(`  ${session}`);
  }
  lines.push("");

  lines.push("--- Environment (for board process) ---");
  const envKeys = [
    "DATABASE_URL",
    "BOARD_PUBLIC_URL",
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "SMEE_WEBHOOK_URL",
    "HOST",
    "WEB_DIST",
    "PORT",
  ];
  for (const key of envKeys) {
    const value = key === "WEB_DIST" ? input.webDist : process.env[key];
    lines.push(`  ${key}=${maskSecret(key, value)}`);
  }
  lines.push(`  COMITIA_WORK_DIR=${input.workDir}`);
  lines.push("");

  const missing = input.missingSecrets ?? [];
  if (missing.length > 0) {
    lines.push("--- Missing secrets (set in environment) ---");
    for (const name of missing) {
      lines.push(`  ${name}`);
    }
    lines.push("");
  }

  lines.push("--- Next steps ---");
  lines.push("  1. Open the login UI and paste the owner token");
  lines.push(`  2. Connect agent: see command above`);
  lines.push("  3. Request session:");
  lines.push(`     curl -s -X POST ${input.boardUrl}/v1/me/request-session \\`);
  lines.push('       -H "Authorization: Bearer <agent-token>" \\');
  lines.push('       -H "content-type: application/json" -d "{}"');
  lines.push("  4. Stop stack: pnpm dogfood:stop");
  lines.push("");

  process.stdout.write(lines.join("\n"));
}

export async function runCommand() {
  const cmd = process.argv[2] === "run" ? process.argv[3] : process.argv[2];
  switch (cmd) {
    case "init-if-needed": {
      const boardUrl = process.env.COMITIA_DOGFOOD_BOARD_URL;
      const databaseUrl = process.env.DATABASE_URL;
      const ownerName = process.env.COMITIA_DOGFOOD_OWNER_NAME ?? "ハル";
      const projectName = process.env.COMITIA_DOGFOOD_PROJECT_NAME ?? "comitia";
      const repoUrl =
        process.env.COMITIA_DOGFOOD_REPO_URL ?? "https://github.com/hskksk/comitia";
      if (!boardUrl) {
        throw new Error("COMITIA_DOGFOOD_BOARD_URL is required");
      }
      const config = await loadConfig();
      if (config?.ownerToken) {
        const me = await fetch(`${boardUrl}/v1/me`, {
          headers: { authorization: `Bearer ${config.ownerToken}` },
        });
        if (me.ok) {
          console.error("Board already initialized (config token valid)");
          return;
        }
      }
      if (databaseUrl && (await boardHasHumanOwner(databaseUrl))) {
        console.error(
          "Board already initialized in DB but owner token missing from ~/.comitia/config.json",
        );
        return;
      }
      await runInit(boardUrl, { ownerName, projectName, repoUrl });
      console.error("Board initialized");
      return;
    }
    case "register-agent-if-needed": {
      const boardUrl = process.env.COMITIA_DOGFOOD_BOARD_URL;
      const agentName = process.env.COMITIA_DOGFOOD_AGENT_NAME ?? "ミカ";
      const config = await loadConfig();
      if (!config?.ownerToken || !boardUrl) {
        throw new Error("Owner token or board URL missing");
      }
      if (config.agents?.[agentName]) {
        console.error(`Agent ${agentName} already registered`);
        return;
      }
      await registerAgent(boardUrl, config.ownerToken, agentName);
      console.error(`Agent ${agentName} registered`);
      return;
    }
    case "connect-github-if-needed": {
      const boardUrl = process.env.COMITIA_DOGFOOD_BOARD_URL;
      const repoUrl =
        process.env.COMITIA_DOGFOOD_REPO_URL ?? "https://github.com/hskksk/comitia";
      const config = await loadConfig();
      if (!config?.ownerToken || !boardUrl) {
        return;
      }
      const parsed = parseRepoOwnerRepo(repoUrl);
      if (!parsed) {
        return;
      }
      const installationId =
        process.env.GITHUB_INSTALLATION_ID ??
        (await fetchInstallationId(parsed.owner, parsed.repo));
      if (!installationId) {
        console.error("GitHub App installation not found — install manually via /v1/github/install");
        return;
      }
      const ok = await connectGitHubInstallation(
        boardUrl,
        config.ownerToken,
        installationId,
      );
      console.error(ok ? "GitHub installation connected" : "GitHub installation connect failed");
      return;
    }
    case "summary": {
      await printSummary({
        boardUrl: process.env.COMITIA_DOGFOOD_BOARD_URL ?? "http://127.0.0.1:8787",
        workDir: process.env.COMITIA_WORK_DIR ?? join(homedir(), ".comitia", "work"),
        webDist: process.env.WEB_DIST,
        agentName: process.env.COMITIA_DOGFOOD_AGENT_NAME ?? "ミカ",
        tmuxSessions: (process.env.COMITIA_DOGFOOD_TMUX_SESSIONS ?? "comitia-board,comitia-smee")
          .split(",")
          .filter(Boolean),
        missingSecrets: (process.env.COMITIA_DOGFOOD_MISSING_SECRETS ?? "")
          .split(",")
          .filter(Boolean),
      });
      return;
    }
    case "resolve-slug": {
      const slug = process.env.GITHUB_APP_SLUG ?? (await fetchGitHubAppSlug());
      if (slug) {
        process.stdout.write(slug);
      }
      return;
    }
    default:
      throw new Error(`Unknown command: ${cmd ?? "(none)"}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCommand().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
