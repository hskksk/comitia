import { eq } from "drizzle-orm";
import { projects } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, PermissionDenied } from "./errors.js";
import { adoptFoundingFromInput } from "./founding.js";
import { getParticipant, getProject } from "./helpers.js";
import { addMembership } from "./memberships.js";

export type FoundingArtifactInput = {
  templateId?: string;
  content?: string;
};

const GITHUB_REPO_URL =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i;

export function parseGithubRepoUrl(
  url: string,
): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  const match = GITHUB_REPO_URL.exec(trimmed);
  if (!match) {
    return null;
  }
  const owner = match[1];
  const repo = match[2]?.replace(/\.git$/i, "");
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

export async function createProject(
  db: Db,
  input: {
    name: string;
    ownerParticipantId: string;
    repoUrl?: string;
    projectRule?: FoundingArtifactInput;
    threadTemplate?: FoundingArtifactInput;
  },
) {
  const owner = await getParticipant(db, input.ownerParticipantId);
  if (owner.kind !== "human") {
    throw new PermissionDenied("プロジェクトオーナーは人間である必要があります");
  }

  const [project] = await db
    .insert(projects)
    .values({
      name: input.name,
      ownerParticipantId: input.ownerParticipantId,
      repoUrl: input.repoUrl ?? null,
    })
    .returning();

  await addMembership(db, {
    projectId: project!.id,
    participantId: input.ownerParticipantId,
    actorId: input.ownerParticipantId,
  });

  await recordEvent(db, {
    projectId: project!.id,
    actorParticipantId: input.ownerParticipantId,
    kind: "project_created",
    payload: {
      projectId: project!.id,
      name: input.name,
      repoUrl: input.repoUrl ?? null,
    },
  });

  if (input.projectRule) {
    await adoptFoundingFromInput(db, {
      projectId: project!.id,
      ownerId: input.ownerParticipantId,
      kind: "project_rule",
      templateId: input.projectRule.templateId,
      content: input.projectRule.content,
    });
  }
  if (input.threadTemplate) {
    await adoptFoundingFromInput(db, {
      projectId: project!.id,
      ownerId: input.ownerParticipantId,
      kind: "thread_template",
      templateId: input.threadTemplate.templateId,
      content: input.threadTemplate.content,
    });
  }

  return project!;
}

export async function updateProject(
  db: Db,
  input: {
    projectId: string;
    actorId: string;
    name?: string;
    repoUrl?: string | null;
  },
) {
  const project = await getProject(db, input.projectId);
  if (project.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("プロジェクトオーナーのみ実行できます");
  }

  const patch: {
    name?: string;
    repoUrl?: string | null;
    githubOwner?: string | null;
    githubRepo?: string | null;
  } = {};
  if (input.name !== undefined) {
    patch.name = input.name;
  }
  if (input.repoUrl !== undefined) {
    if (input.repoUrl === null || input.repoUrl.trim() === "") {
      patch.repoUrl = null;
      patch.githubOwner = null;
      patch.githubRepo = null;
    } else {
      const parsed = parseGithubRepoUrl(input.repoUrl);
      if (!parsed) {
        throw new GateViolation("repoUrl は GitHub の owner/repo 形式にしてください");
      }
      patch.githubOwner = parsed.owner;
      patch.githubRepo = parsed.repo;
      patch.repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
    }
  }

  const [updated] = await db
    .update(projects)
    .set(patch)
    .where(eq(projects.id, input.projectId))
    .returning();

  await recordEvent(db, {
    projectId: input.projectId,
    actorParticipantId: input.actorId,
    kind: "project_updated",
    payload: {
      projectId: input.projectId,
      name: updated!.name,
      repoUrl: updated!.repoUrl,
    },
  });
  return updated!;
}
