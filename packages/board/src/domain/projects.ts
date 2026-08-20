import { eq } from "drizzle-orm";
import { projects } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, PermissionDenied } from "./errors.js";
import { getParticipant, getProject } from "./helpers.js";

const PROJECT_REPO_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

export function parseProjectRepoUrl(url: string): { owner: string; repo: string } {
  const match = PROJECT_REPO_URL.exec(url.trim());
  if (!match) {
    throw new GateViolation("リポジトリ URL が不正です");
  }
  return { owner: match[1]!, repo: match[2]! };
}

export async function createProject(
  db: Db,
  input: {
    name: string;
    ownerParticipantId: string;
    repoUrl?: string;
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

  return project!;
}

export async function updateProjectRepo(
  db: Db,
  input: { projectId: string; repoUrl: string | null },
) {
  await getProject(db, input.projectId);

  if (!input.repoUrl || !input.repoUrl.trim()) {
    const [updated] = await db
      .update(projects)
      .set({ repoUrl: null, githubOwner: null, githubRepo: null })
      .where(eq(projects.id, input.projectId))
      .returning();
    return updated!;
  }

  const { owner, repo } = parseProjectRepoUrl(input.repoUrl);
  const [updated] = await db
    .update(projects)
    .set({ repoUrl: input.repoUrl, githubOwner: owner, githubRepo: repo })
    .where(eq(projects.id, input.projectId))
    .returning();

  return updated!;
}
