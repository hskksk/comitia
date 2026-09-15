import { and, asc, desc, eq } from "drizzle-orm";
import {
  SHARED_ARTIFACT_KINDS,
  type SharedArtifactKind,
  type ThreadType,
  type ProposalTarget,
} from "@comitia/shared";
import { agreements, proposalVersions, threads } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { GateViolation } from "./errors.js";

export type ProjectSetup = {
  projectRule: boolean;
  threadTemplate: boolean;
};

export type ConstitutionKind = Extract<
  SharedArtifactKind,
  "project_rule" | "thread_template"
>;

export function isConstitutionKind(
  kind: SharedArtifactKind | null | undefined,
): kind is ConstitutionKind {
  return kind === "project_rule" || kind === "thread_template";
}

export type ActiveSharedArtifact = {
  agreementId: string;
  threadId: string;
  summary: string;
  content: string;
  createdAt: string;
};

export type SharedArtifactListItem = {
  kind: SharedArtifactKind;
  threadId: string;
  agreementId: string;
  summary: string;
  content: string;
  createdAt: string;
};

export type BriefingSharedArtifacts = {
  project_rule: { threadId: string; summary: string; content: string } | null;
  thread_template: { threadId: string; summary: string; content: string } | null;
  skills: Array<{ threadId: string; summary: string }>;
};

function toConstitutionPointer(row: ActiveSharedArtifact | null) {
  if (!row) {
    return null;
  }
  return {
    threadId: row.threadId,
    summary: row.summary,
    content: row.content,
  };
}

async function listActiveAdoptedArtifacts(
  db: Db,
  projectId: string,
  kind: SharedArtifactKind,
  options?: { latestOnly?: boolean },
): Promise<SharedArtifactListItem[]> {
  const query = db
    .select({
      agreementId: agreements.id,
      threadId: agreements.threadId,
      summary: agreements.summary,
      content: proposalVersions.content,
      createdAt: agreements.createdAt,
    })
    .from(agreements)
    .innerJoin(threads, eq(agreements.threadId, threads.id))
    .innerJoin(
      proposalVersions,
      eq(agreements.proposalVersionId, proposalVersions.id),
    )
    .where(
      and(
        eq(agreements.projectId, projectId),
        eq(agreements.state, "active"),
        eq(agreements.outcome, "adopted"),
        eq(threads.sharedArtifactKind, kind),
      ),
    )
    .orderBy(
      options?.latestOnly ? desc(agreements.createdAt) : asc(agreements.createdAt),
    );
  const rows = options?.latestOnly ? await query.limit(1) : await query;
  return rows.map((row) => ({
    kind,
    agreementId: row.agreementId,
    threadId: row.threadId,
    summary: row.summary,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getActiveSharedArtifact(
  db: Db,
  projectId: string,
  kind: ConstitutionKind,
): Promise<ActiveSharedArtifact | null> {
  const [row] = await listActiveAdoptedArtifacts(db, projectId, kind, {
    latestOnly: true,
  });
  if (!row) {
    return null;
  }
  return {
    agreementId: row.agreementId,
    threadId: row.threadId,
    summary: row.summary,
    content: row.content,
    createdAt: row.createdAt,
  };
}

export async function listSharedArtifacts(
  db: Db,
  input: { projectId: string; kind?: SharedArtifactKind },
): Promise<SharedArtifactListItem[]> {
  const kinds = input.kind ? [input.kind] : [...SHARED_ARTIFACT_KINDS];
  const groups = await Promise.all(
    kinds.map((kind) =>
      isConstitutionKind(kind)
        ? listActiveAdoptedArtifacts(db, input.projectId, kind, {
            latestOnly: true,
          })
        : listActiveAdoptedArtifacts(db, input.projectId, kind),
    ),
  );
  return groups.flat();
}

export async function getBriefingSharedArtifacts(
  db: Db,
  projectId: string,
): Promise<BriefingSharedArtifacts> {
  const [projectRule, threadTemplate, skills] = await Promise.all([
    getActiveSharedArtifact(db, projectId, "project_rule"),
    getActiveSharedArtifact(db, projectId, "thread_template"),
    listActiveAdoptedArtifacts(db, projectId, "skill"),
  ]);
  return {
    project_rule: toConstitutionPointer(projectRule),
    thread_template: toConstitutionPointer(threadTemplate),
    skills: skills.map((row) => ({
      threadId: row.threadId,
      summary: row.summary,
    })),
  };
}

export async function hasActiveSharedArtifact(
  db: Db,
  projectId: string,
  kind: ConstitutionKind,
): Promise<boolean> {
  const artifact = await getActiveSharedArtifact(db, projectId, kind);
  return artifact !== null;
}

export async function getProjectSetup(
  db: Db,
  projectId: string,
): Promise<ProjectSetup> {
  const [projectRule, threadTemplate] = await Promise.all([
    hasActiveSharedArtifact(db, projectId, "project_rule"),
    hasActiveSharedArtifact(db, projectId, "thread_template"),
  ]);
  return { projectRule, threadTemplate };
}

export function isSetupComplete(setup: ProjectSetup): boolean {
  return setup.projectRule && setup.threadTemplate;
}

export async function assertCreateThreadAllowed(
  db: Db,
  input: {
    projectId: string;
    type: ThreadType;
    target?: ProposalTarget;
    sharedArtifactKind?: SharedArtifactKind;
  },
): Promise<void> {
  const setup = await getProjectSetup(db, input.projectId);
  if (isSetupComplete(setup)) {
    return;
  }
  const allowed =
    input.type === "proposal" &&
    input.target === "shared_artifact" &&
    isConstitutionKind(input.sharedArtifactKind);
  if (!allowed) {
    throw new GateViolation(
      "プロジェクトルールとスレッドテンプレが決まるまで、それら以外のスレッドは立てられません",
    );
  }
}
