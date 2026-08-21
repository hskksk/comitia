import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { getSystemTemplate, listSystemTemplates } from "../catalog/index.js";
import { declare } from "./declare.js";
import { GateViolation, PermissionDenied } from "./errors.js";
import { adoptFoundingFromInput, adoptDefaultFounding } from "./founding.js";
import { registerParticipant } from "./participants.js";
import { addProposal } from "./proposals.js";
import { createProject } from "./projects.js";
import { createThread } from "./threads.js";
import { getProjectSetup, getActiveSharedArtifact } from "./constitution.js";

describe("system templates", () => {
  it("lists project_rule and thread_template catalogs", () => {
    const all = listSystemTemplates();
    expect(all.some((t) => t.kind === "project_rule" && t.id === "default")).toBe(
      true,
    );
    expect(
      all.some((t) => t.kind === "thread_template" && t.id === "minimal"),
    ).toBe(true);
    expect(getSystemTemplate("project_rule", "strict")?.title).toContain("厳格");
  });
});

describe("project setup gate", () => {
  it("blocks non-constitution threads until both artifacts are adopted", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "empty",
      ownerParticipantId: owner.id,
    });
    expect(await getProjectSetup(db, project.id)).toEqual({
      projectRule: false,
      threadTemplate: false,
    });

    await expect(
      createThread(db, {
        projectId: project.id,
        ownerId: owner.id,
        type: "implementation",
        title: "作業",
        trigger: "きっかけ",
        duplicateSearchQuery: "work",
        conflictCitationsChecked: true,
      }),
    ).rejects.toThrow(GateViolation);

    await expect(
      createThread(db, {
        projectId: project.id,
        ownerId: owner.id,
        type: "proposal",
        target: "repo_artifact",
        title: "コード",
        trigger: "きっかけ",
        duplicateSearchQuery: "code",
        conflictCitationsChecked: true,
      }),
    ).rejects.toThrow(GateViolation);

    const ruleThread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "proposal",
      target: "shared_artifact",
      sharedArtifactKind: "project_rule",
      title: "ルール創設",
      trigger: "未設定",
      duplicateSearchQuery: "project_rule",
      conflictCitationsChecked: true,
    });
    expect(ruleThread.consensusType).toBe("human_ratification");
  });

  it("adopts founding artifacts at create time from a catalog template", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "with-founding",
      ownerParticipantId: owner.id,
      projectRule: { templateId: "lightweight" },
      threadTemplate: { templateId: "minimal" },
    });
    expect(await getProjectSetup(db, project.id)).toEqual({
      projectRule: true,
      threadTemplate: true,
    });

    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "implementation",
      title: "作業",
      trigger: "きっかけ",
      duplicateSearchQuery: "work",
      conflictCitationsChecked: true,
    });
    expect(thread.type).toBe("implementation");
  });

  it("lets the owner self-ratify a founding project_rule", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "self-founding",
      ownerParticipantId: owner.id,
    });
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "proposal",
      target: "shared_artifact",
      sharedArtifactKind: "project_rule",
      title: "創設ルール",
      trigger: "未設定",
      duplicateSearchQuery: "rule",
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: owner.id,
      content: "創設の本文",
    });
    await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });
    await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "request_ratification",
      payload: {},
    });
    const decided = await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "ratify",
      payload: { binding: true, summary: "創設を批准" },
    });
    expect(decided.thread.state).toBe("decided");
    expect(await getProjectSetup(db, project.id)).toMatchObject({
      projectRule: true,
    });
  });

  it("still blocks self-ratify on project_rule amendments", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "amend",
      ownerParticipantId: owner.id,
    });
    await adoptFoundingFromInput(db, {
      projectId: project.id,
      ownerId: owner.id,
      kind: "project_rule",
      templateId: "default",
    });
    await adoptFoundingFromInput(db, {
      projectId: project.id,
      ownerId: owner.id,
      kind: "thread_template",
      templateId: "default",
    });

    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "proposal",
      target: "shared_artifact",
      sharedArtifactKind: "project_rule",
      title: "改正",
      trigger: "改正したい",
      duplicateSearchQuery: "amend",
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: owner.id,
      content: "改正案",
    });
    await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });
    await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "request_ratification",
      payload: {},
    });
    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: owner.id,
        kind: "ratify",
        payload: { binding: true, summary: "自分で決める" },
      }),
    ).rejects.toThrow(PermissionDenied);
  });

  it("adoptDefaultFounding is idempotent enough to skip already-set kinds", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "ready",
      ownerParticipantId: owner.id,
      projectRule: { templateId: "default" },
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });
    expect(await getProjectSetup(db, project.id)).toEqual({
      projectRule: true,
      threadTemplate: true,
    });
  });

  it("returns active shared artifact content for the dashboard", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "ready",
      ownerParticipantId: owner.id,
      projectRule: { templateId: "lightweight" },
    });

    const artifact = await getActiveSharedArtifact(db, project.id, "project_rule");
    expect(artifact).not.toBeNull();
    expect(artifact!.content).toContain("プロジェクトルール（軽量）");
    expect(artifact!.summary).toBeTruthy();
    expect(artifact!.threadId).toBeTruthy();
  });
});
