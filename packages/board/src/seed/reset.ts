import { eq, inArray } from "drizzle-orm";
import {
  agentCredentials,
  agreements,
  events,
  githubIssueIntakes,
  handovers,
  personalNoteComments,
  personalNotes,
  posts,
  projectInvites,
  projectMemberships,
  projects,
  proposals,
  proposalVersions,
  roleAssignments,
  sessionGoals,
  sessions,
  threadConflictCitations,
  threadPullRequests,
  threads,
  ticks,
  workClaims,
} from "../db/schema.js";
import type { Db } from "../db/types.js";

export async function deleteProjectTree(db: Db, projectId: string) {
  const threadRows = await db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.projectId, projectId));
  const threadIds = threadRows.map((row) => row.id);
  const sessionRows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.projectId, projectId));
  const sessionIds = sessionRows.map((row) => row.id);
  const noteRows = await db
    .select({ id: personalNotes.id })
    .from(personalNotes)
    .where(eq(personalNotes.projectId, projectId));
  const noteIds = noteRows.map((row) => row.id);

  if (threadIds.length > 0) {
    await db
      .delete(threadConflictCitations)
      .where(inArray(threadConflictCitations.threadId, threadIds));
    await db.delete(posts).where(inArray(posts.threadId, threadIds));
    await db
      .update(threads)
      .set({ candidateProposalVersionId: null })
      .where(inArray(threads.id, threadIds));
    await db
      .update(agreements)
      .set({ supersededByAgreementId: null })
      .where(eq(agreements.projectId, projectId));
    await db.delete(agreements).where(eq(agreements.projectId, projectId));
    const proposalRows = await db
      .select({ id: proposals.id })
      .from(proposals)
      .where(inArray(proposals.threadId, threadIds));
    const proposalIds = proposalRows.map((row) => row.id);
    if (proposalIds.length > 0) {
      await db
        .delete(proposalVersions)
        .where(inArray(proposalVersions.proposalId, proposalIds));
      await db.delete(proposals).where(inArray(proposals.id, proposalIds));
    }
    await db.delete(workClaims).where(eq(workClaims.projectId, projectId));
    await db
      .delete(threadPullRequests)
      .where(eq(threadPullRequests.projectId, projectId));
    await db
      .delete(githubIssueIntakes)
      .where(eq(githubIssueIntakes.projectId, projectId));
    await db.delete(threads).where(eq(threads.projectId, projectId));
  }

  if (sessionIds.length > 0) {
    await db
      .delete(sessionGoals)
      .where(inArray(sessionGoals.sessionId, sessionIds));
    await db.delete(handovers).where(inArray(handovers.sessionId, sessionIds));
    await db.delete(ticks).where(inArray(ticks.sessionId, sessionIds));
    await db.delete(sessions).where(eq(sessions.projectId, projectId));
  }

  if (noteIds.length > 0) {
    await db
      .delete(personalNoteComments)
      .where(inArray(personalNoteComments.noteId, noteIds));
    await db.delete(personalNotes).where(eq(personalNotes.projectId, projectId));
  }

  await db.delete(events).where(eq(events.projectId, projectId));
  await db.delete(roleAssignments).where(eq(roleAssignments.projectId, projectId));
  await db.delete(projectInvites).where(eq(projectInvites.projectId, projectId));
  await db
    .delete(agentCredentials)
    .where(eq(agentCredentials.projectId, projectId));
  await db
    .delete(projectMemberships)
    .where(eq(projectMemberships.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
}
