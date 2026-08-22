import { eq } from "drizzle-orm";
import { projectMemberships } from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { GitHubClient } from "../github/types.js";
import { getProject } from "./helpers.js";
import {
  isProjectMember,
  resolveUniqueMembershipProjectId,
} from "./memberships.js";

export type AgentGithubCredentials = {
  token: string;
  expiresAt: Date;
  owner: string;
  repo: string;
  repoUrl: string;
};

export type AgentGithubCredentialsFailure = {
  ok: false;
  status: 400 | 403 | 404 | 502 | 503;
  error: string;
};

export type AgentGithubCredentialsResult =
  | ({ ok: true } & AgentGithubCredentials)
  | AgentGithubCredentialsFailure;

export async function issueAgentGithubCredentials(
  db: Db,
  github: GitHubClient | undefined,
  input: {
    participantId: string;
    requestedProjectId?: string | null;
    credentialProjectId: string | null;
  },
): Promise<AgentGithubCredentialsResult> {
  if (!github) {
    return { ok: false, status: 503, error: "GitHub App is not configured" };
  }

  const projectId = await resolveAgentGithubProjectId(db, input);
  if (!projectId.ok) {
    return projectId;
  }

  const project = await getProject(db, projectId.id);
  if (
    !project.repoUrl ||
    !project.githubInstallationId ||
    !project.githubOwner ||
    !project.githubRepo
  ) {
    return { ok: false, status: 404, error: "github credentials unavailable" };
  }

  try {
    const minted = await github.createInstallationAccessToken({
      installationId: project.githubInstallationId,
      owner: project.githubOwner,
      repo: project.githubRepo,
    });
    return {
      ok: true,
      token: minted.token,
      expiresAt: minted.expiresAt,
      owner: project.githubOwner,
      repo: project.githubRepo,
      repoUrl: project.repoUrl,
    };
  } catch {
    return { ok: false, status: 502, error: "failed to mint GitHub credentials" };
  }
}

async function resolveAgentGithubProjectId(
  db: Db,
  input: {
    participantId: string;
    requestedProjectId?: string | null;
    credentialProjectId: string | null;
  },
): Promise<{ ok: true; id: string } | AgentGithubCredentialsFailure> {
  if (input.requestedProjectId) {
    if (
      !(await isProjectMember(db, input.requestedProjectId, input.participantId))
    ) {
      return { ok: false, status: 403, error: "not a project member" };
    }
    return { ok: true, id: input.requestedProjectId };
  }

  const unique = await resolveUniqueMembershipProjectId(
    db,
    input.participantId,
  );
  if (unique) {
    return { ok: true, id: unique };
  }

  const rows = await db
    .select({ projectId: projectMemberships.projectId })
    .from(projectMemberships)
    .where(eq(projectMemberships.participantId, input.participantId));
  if (rows.length === 0 && input.credentialProjectId) {
    return { ok: true, id: input.credentialProjectId };
  }
  return { ok: false, status: 400, error: "project required" };
}
