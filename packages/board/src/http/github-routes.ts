import { and, eq } from "drizzle-orm";
import { Webhooks } from "@octokit/webhooks";
import type { Hono } from "hono";
import { projects, threadPullRequests } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { intakeOpenedIssue } from "../domain/issue-intake.js";
import { syncPullRequest } from "../domain/pull-requests.js";
import { mapPullRequestState } from "../github/map-pr-state.js";
import type { GitHubClient } from "../github/types.js";
import { recordEvent } from "../domain/events.js";
import { GateViolation } from "../domain/errors.js";
import type { BoardEnv } from "./auth.js";
import { requireAuth, requireOwner } from "./auth.js";

type GithubEventInput = {
  event: string;
  payload: Record<string, unknown>;
  publicBaseUrl: string;
};

function repositoryFromPayload(payload: Record<string, unknown>) {
  const repository = payload.repository as
    | { full_name?: string; owner?: { login?: string }; name?: string }
    | undefined;
  if (!repository?.full_name) {
    return null;
  }
  const [owner, repo] = repository.full_name.split("/");
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

export async function findProjectByRepo(
  db: Db,
  input: { owner: string; repo: string },
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.githubOwner, input.owner),
        eq(projects.githubRepo, input.repo),
      ),
    )
    .limit(1);
  return project ?? null;
}

export async function handleGithubEvent(
  db: Db,
  github: GitHubClient,
  input: GithubEventInput,
) {
  if (input.event === "pull_request") {
    const repo = repositoryFromPayload(input.payload);
    if (!repo) {
      return;
    }
    const project = await findProjectByRepo(db, repo);
    if (!project?.githubInstallationId) {
      return;
    }
    const pullRequest = input.payload.pull_request as
      | {
          number?: number;
          title?: string;
          state?: string;
          merged?: boolean;
          merged_at?: string | null;
        }
      | undefined;
    if (!pullRequest?.number) {
      return;
    }
    await syncPullRequest(db, github, {
      projectId: project.id,
      number: pullRequest.number,
    });
    return;
  }

  if (input.event === "issues") {
    const action = input.payload.action;
    if (action !== "opened") {
      return;
    }
    const repo = repositoryFromPayload(input.payload);
    if (!repo) {
      return;
    }
    const project = await findProjectByRepo(db, repo);
    if (!project) {
      return;
    }
    const issue = input.payload.issue as
      | {
          number?: number;
          title?: string;
          html_url?: string;
          pull_request?: unknown;
        }
      | undefined;
    if (!issue?.number || !issue.html_url) {
      return;
    }
    await intakeOpenedIssue(db, github, {
      projectId: project.id,
      issueNumber: issue.number,
      title: issue.title ?? "",
      htmlUrl: issue.html_url,
      isPullRequest: Boolean(issue.pull_request),
      publicBaseUrl: input.publicBaseUrl,
    });
  }
}

export function mapWebhookPullRequestState(payload: Record<string, unknown>) {
  const pullRequest = payload.pull_request as
    | { state?: string; merged_at?: string | null }
    | undefined;
  if (!pullRequest) {
    return "open" as const;
  }
  return mapPullRequestState({
    state: pullRequest.state ?? "open",
    merged: pullRequest.merged_at != null,
  });
}

export async function connectInstallation(
  db: Db,
  github: GitHubClient,
  input: { projectId: string; installationId: string; actorId: string },
) {
  const repos = await github.listInstallationRepos(input.installationId);
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) {
    throw new GateViolation("プロジェクトが見つかりません");
  }

  let selected = repos[0];
  if (repos.length > 1) {
    const match = project.repoUrl
      ? repos.find(
          (repo) =>
            project.repoUrl ===
            `https://github.com/${repo.owner}/${repo.repo}`,
        )
      : undefined;
    if (!match) {
      throw new GateViolation(
        "Layer 1 では単一リポジトリへのインストールが必要です",
      );
    }
    selected = match;
  }
  if (!selected) {
    throw new GateViolation("インストールされたリポジトリがありません");
  }

  const repoUrl = `https://github.com/${selected.owner}/${selected.repo}`;
  const [updated] = await db
    .update(projects)
    .set({
      githubInstallationId: input.installationId,
      githubOwner: selected.owner,
      githubRepo: selected.repo,
      repoUrl,
    })
    .where(eq(projects.id, input.projectId))
    .returning();

  await recordEvent(db, {
    projectId: input.projectId,
    actorParticipantId: input.actorId,
    kind: "github_installation_connected",
    payload: {
      installationId: input.installationId,
      owner: selected.owner,
      repo: selected.repo,
    },
  });

  return updated!;
}

export function registerGithubRoutes(
  app: Hono<BoardEnv>,
  input: {
    db: Db;
    github?: GitHubClient;
    webhookSecret?: string;
    publicBaseUrl?: string;
  },
) {
  const auth = requireAuth(input.db);
  const owner = requireOwner();

  app.post("/v1/github/webhook", async (c) => {
    if (!input.github || !input.webhookSecret) {
      return c.text("GitHub webhook is not configured", 503);
    }
    const signature = c.req.header("x-hub-signature-256");
    const event = c.req.header("x-github-event") ?? "";
    const rawBody = await c.req.text();
    const webhooks = new Webhooks({ secret: input.webhookSecret });
    const verified = await webhooks.verify(rawBody, signature ?? "");
    if (!verified) {
      return c.text("invalid signature", 401);
    }
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    await handleGithubEvent(input.db, input.github, {
      event,
      payload,
      publicBaseUrl: input.publicBaseUrl ?? "",
    });
    return c.body(null, 202);
  });

  app.post("/v1/github/sync", auth, owner, async (c) => {
    if (!input.github) {
      return c.json({ error: "GitHub is not configured" }, 503);
    }
    const projectId = c.get("projectId");
    const linked = await input.db
      .select({ number: threadPullRequests.number })
      .from(threadPullRequests)
      .where(eq(threadPullRequests.projectId, projectId));
    for (const row of linked) {
      try {
        await syncPullRequest(input.db, input.github, {
          projectId,
          number: row.number,
        });
      } catch {
        // Ignore per-PR failures.
      }
    }
    return c.json({ ok: true });
  });
}
