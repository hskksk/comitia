import { declare } from "../domain/declare.js";
import { addPost } from "../domain/posts.js";
import { addProposal } from "../domain/proposals.js";
import { registerParticipant } from "../domain/participants.js";
import { createProject } from "../domain/projects.js";
import { createThread } from "../domain/threads.js";
import type { Db } from "../db/test-setup.js";

export async function seedOwnerAgentProject(db: Db) {
  const owner = await registerParticipant(db, {
    kind: "human",
    displayName: "ハル",
  });
  const agent = await registerParticipant(db, {
    kind: "agent",
    displayName: "ミカ",
    ownerParticipantId: owner.id,
    engine: "claude-code",
  });
  const project = await createProject(db, {
    name: "comitia",
    ownerParticipantId: owner.id,
  });
  return { owner, agent, project };
}

export async function seedAwaitingRatification(
  db: Db,
  input: {
    ownerId: string;
    agentId: string;
    projectId: string;
    title?: string;
    synthesis?: string;
  },
) {
  const thread = await createThread(db, {
    projectId: input.projectId,
    ownerId: input.agentId,
    type: "proposal",
    target: "shared_artifact",
    sharedArtifactKind: "project_rule",
    title: input.title ?? "ルール改正",
    trigger: "憲法層の変更",
    duplicateSearchQuery: "rule amendment",
    consensusType: "human_ratification",
    conflictCitationsChecked: true,
  });
  const { version } = await addProposal(db, {
    threadId: thread.id,
    authorId: input.agentId,
    content: "区分を導入する",
  });
  await declare(db, {
    threadId: thread.id,
    actorId: input.agentId,
    kind: "select_candidate",
    payload: { proposalVersionId: version.id },
  });
  if (input.synthesis) {
    await addPost(db, {
      threadId: thread.id,
      authorId: input.agentId,
      type: "synthesis",
      body: input.synthesis,
    });
  }
  await declare(db, {
    threadId: thread.id,
    actorId: input.agentId,
    kind: "request_ratification",
    payload: {},
  });
  return { thread, version };
}

export async function seedDecidedImplementation(
  db: Db,
  input: {
    agentId: string;
    projectId: string;
    title?: string;
    report?: string;
  },
) {
  const thread = await createThread(db, {
    projectId: input.projectId,
    ownerId: input.agentId,
    type: "implementation",
    title: input.title ?? "typo 修正",
    trigger: "表記ゆれ",
    duplicateSearchQuery: "typo",
    consensusType: "owner_decision",
    conflictCitationsChecked: true,
  });
  const { version } = await addProposal(db, {
    threadId: thread.id,
    authorId: input.agentId,
    content: "Comittia → Comitia",
  });
  await declare(db, {
    threadId: thread.id,
    actorId: input.agentId,
    kind: "select_candidate",
    payload: { proposalVersionId: version.id },
  });
  await declare(db, {
    threadId: thread.id,
    actorId: input.agentId,
    kind: "owner_decide",
    payload: { binding: false, summary: "表記修正を採用" },
  });
  if (input.report) {
    await addPost(db, {
      threadId: thread.id,
      authorId: input.agentId,
      type: "report",
      body: input.report,
    });
  }
  return { thread, version };
}
