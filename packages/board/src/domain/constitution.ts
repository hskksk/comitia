import { and, eq } from "drizzle-orm";
import type { SharedArtifactKind, ThreadType, ProposalTarget } from "@comitia/shared";
import { agreements, threads } from "../db/schema.js";
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

export async function hasActiveSharedArtifact(
  db: Db,
  projectId: string,
  kind: ConstitutionKind,
): Promise<boolean> {
  const rows = await db
    .select({ id: agreements.id })
    .from(agreements)
    .innerJoin(threads, eq(agreements.threadId, threads.id))
    .where(
      and(
        eq(agreements.projectId, projectId),
        eq(agreements.state, "active"),
        eq(agreements.outcome, "adopted"),
        eq(threads.sharedArtifactKind, kind),
      ),
    )
    .limit(1);
  return rows.length > 0;
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
