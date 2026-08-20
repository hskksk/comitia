import {
  AGREEMENT_STATES,
  PROJECT_ID_HEADER,
  declarationPayloadSchema,
  engineDiversitySchema,
  roleSchema,
  threadTypeSchema,
  consensusTypeSchema,
  proposalTargetSchema,
  sharedArtifactKindSchema,
  postTypeSchema,
} from "@comitia/shared";
import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/types.js";
import { assignRole } from "../domain/roles.js";
import { declare } from "../domain/declare.js";
import { NotFoundError, PermissionDenied } from "../domain/errors.js";
import {
  getHumanThreadView,
  listJudgmentQueue,
  listNonblockingInbox,
  listProjectThreads,
} from "../domain/human-views.js";
import {
  getOwnerChatLog,
  getProjectSummary,
  listAgentSessions,
  listHumanAgreements,
  listOpenSessions,
  listProjectParticipants,
  listRecentEvents,
} from "../domain/human-ops.js";
import { addPost } from "../domain/posts.js";
import { addProposal } from "../domain/proposals.js";
import { createThread, searchThreads } from "../domain/threads.js";
import { linkPullRequest, refreshStalePullRequests } from "../domain/pull-requests.js";
import { listActiveMemory } from "../domain/memory.js";
import { maybeFinalizeUnanimous } from "../domain/timed-consensus.js";
import { commentNote, readNote, searchNotes, writeNote } from "../domain/notes.js";
import { claimWork, releaseWork } from "../domain/work-claims.js";
import {
  createProjectInvite,
  joinProjectByInvite,
  updateHumanProfile,
} from "../domain/accounts.js";
import { archiveProposal, archiveThread } from "../domain/archive.js";
import { buildMeResponse } from "../domain/identity.js";
import {
  listMembershipsForParticipant,
  removeHumanMember,
  resolveHumanProjectId,
} from "../domain/memberships.js";
import { createProject, updateProject } from "../domain/projects.js";
import {
  archiveOwnedAgent,
  listOwnedAgents,
  updateOwnedAgent,
} from "../domain/owned-agents.js";
import type { GitHubClient } from "../github/types.js";
import {
  type BoardEnv,
  requireAuth,
  requireHuman,
  requireProjectMember,
  requireProjectOwner,
} from "./auth.js";

function assertProject(viewProjectId: string, requestProjectId: string) {
  if (viewProjectId !== requestProjectId) {
    throw new NotFoundError("スレッドが見つかりません");
  }
}

function jsonErrorStatus(error: unknown) {
  if (error instanceof PermissionDenied) {
    return { status: 403 as const, message: error.message };
  }
  if (error instanceof NotFoundError) {
    return { status: 404 as const, message: error.message };
  }
  return null;
}

export function registerHumanRoutes(
  app: Hono<BoardEnv>,
  db: Db,
  options?: { github?: GitHubClient },
) {
  const auth = requireAuth(db);
  const human = requireHuman();
  const member = requireProjectMember(db);
  const memberById = requireProjectMember(db, { fromParam: "id" });
  const projectOwner = requireProjectOwner(db);

  app.get("/v1/me", auth, async (c) => {
    const participant = c.get("participant");
    const headerProjectId = c.req.header(PROJECT_ID_HEADER) ?? undefined;
    const storedProjectId = c.var.projectId;
    let selectedProjectId = headerProjectId ?? storedProjectId;
    if (participant.kind === "human" && headerProjectId) {
      try {
        selectedProjectId = await resolveHumanProjectId(db, {
          participantId: participant.id,
          credentialProjectId: c.get("credentialProjectId"),
          headerProjectId,
        });
      } catch {
        selectedProjectId = headerProjectId;
      }
    }
    return c.json(
      await buildMeResponse(db, {
        participant,
        credentialProjectId: c.get("credentialProjectId"),
        selectedProjectId,
      }),
    );
  });

  app.patch("/v1/me", auth, human, async (c) => {
    const body = z.object({ displayName: z.string().min(1) }).parse(await c.req.json());
    const updated = await updateHumanProfile(db, {
      participantId: c.get("participant").id,
      displayName: body.displayName,
    });
    return c.json({
      participant: {
        id: updated.id,
        kind: updated.kind,
        displayName: updated.displayName,
      },
    });
  });

  app.get("/v1/me/agents", auth, human, async (c) => {
    const items = await listOwnedAgents(db, c.get("participant").id);
    return c.json({
      items: items.map((agent) => ({
        id: agent.id,
        displayName: agent.displayName,
        engine: agent.engine,
        ownerParticipantId: agent.ownerParticipantId,
      })),
    });
  });

  app.patch("/v1/me/agents/:agentId", auth, human, async (c) => {
    const body = z
      .object({
        displayName: z.string().min(1).optional(),
        engine: z.string().optional(),
      })
      .parse(await c.req.json());
    try {
      const updated = await updateOwnedAgent(db, {
        actorId: c.get("participant").id,
        agentId: c.req.param("agentId"),
        displayName: body.displayName,
        engine: body.engine,
      });
      return c.json({
        id: updated.id,
        displayName: updated.displayName,
        engine: updated.engine,
      });
    } catch (error) {
      const mapped = jsonErrorStatus(error);
      if (mapped) {
        return c.json({ error: mapped.message }, mapped.status);
      }
      throw error;
    }
  });

  app.delete("/v1/me/agents/:agentId", auth, human, async (c) => {
    try {
      await archiveOwnedAgent(db, {
        actorId: c.get("participant").id,
        agentId: c.req.param("agentId"),
      });
      return c.body(null, 204);
    } catch (error) {
      const mapped = jsonErrorStatus(error);
      if (mapped) {
        return c.json({ error: mapped.message }, mapped.status);
      }
      throw error;
    }
  });

  app.post("/v1/projects", auth, human, async (c) => {
    const body = z
      .object({
        name: z.string().min(1),
        repoUrl: z.string().url().optional(),
      })
      .parse(await c.req.json());
    const project = await createProject(db, {
      name: body.name,
      ownerParticipantId: c.get("participant").id,
      repoUrl: body.repoUrl,
    });
    return c.json(
      {
        id: project.id,
        name: project.name,
        repoUrl: project.repoUrl,
        ownerParticipantId: project.ownerParticipantId,
      },
      201,
    );
  });

  app.get("/v1/projects", auth, human, async (c) => {
    const items = await listMembershipsForParticipant(db, c.get("participant").id);
    return c.json({ items });
  });

  app.get("/v1/projects/:id", auth, human, memberById, async (c) => {
    const summary = await getProjectSummary(db, c.get("projectId"));
    const members = await listProjectParticipants(db, c.get("projectId"));
    const humans = members.filter((row) => row.kind === "human").length;
    const agents = members.filter((row) => row.kind === "agent");
    return c.json({
      ...summary,
      participantStats: {
        humans,
        agentsConnected: agents.filter((row) => row.connection?.status === "connected")
          .length,
        agentsDisconnected: agents.filter(
          (row) => row.connection?.status !== "connected",
        ).length,
      },
    });
  });

  app.patch("/v1/projects/:id", auth, human, memberById, projectOwner, async (c) => {
    const body = z
      .object({
        name: z.string().min(1).optional(),
        repoUrl: z.string().nullable().optional(),
      })
      .parse(await c.req.json());
    const project = await updateProject(db, {
      projectId: c.get("projectId"),
      actorId: c.get("participant").id,
      name: body.name,
      repoUrl: body.repoUrl,
    });
    return c.json({
      id: project.id,
      name: project.name,
      repoUrl: project.repoUrl,
      githubOwner: project.githubOwner,
      githubRepo: project.githubRepo,
    });
  });

  app.post("/v1/projects/:id/invites", auth, human, memberById, projectOwner, async (c) => {
    const invite = await createProjectInvite(db, {
      projectId: c.get("projectId"),
      actorId: c.get("participant").id,
    });
    return c.json(invite, 201);
  });

  app.get("/v1/projects/:id/members", auth, human, memberById, async (c) => {
    const items = await listProjectParticipants(db, c.get("projectId"));
    return c.json({ items });
  });

  app.delete(
    "/v1/projects/:id/members/:participantId",
    auth,
    human,
    memberById,
    projectOwner,
    async (c) => {
      try {
        await removeHumanMember(db, {
          projectId: c.get("projectId"),
          participantId: c.req.param("participantId"),
          actorId: c.get("participant").id,
        });
        return c.body(null, 204);
      } catch (error) {
        const mapped = jsonErrorStatus(error);
        if (mapped) {
          return c.json({ error: mapped.message }, mapped.status);
        }
        throw error;
      }
    },
  );

  app.post("/v1/join", auth, human, async (c) => {
    const body = z.object({ token: z.string().min(1) }).parse(await c.req.json());
    const project = await joinProjectByInvite(db, {
      participantId: c.get("participant").id,
      token: body.token,
    });
    return c.json({
      id: project.id,
      name: project.name,
      ownerParticipantId: project.ownerParticipantId,
    });
  });

  app.get("/v1/queue", auth, human, member, async (c) => {
    const items = await listJudgmentQueue(db, {
      projectId: c.get("projectId"),
    });
    return c.json({ items });
  });

  app.get("/v1/inbox", auth, human, member, async (c) => {
    const projectId = c.get("projectId");
    if (options?.github) {
      await refreshStalePullRequests(db, options.github, {
        projectId,
        maxAgeMs: 5 * 60 * 1000,
      });
    }
    const items = await listNonblockingInbox(db, { projectId });
    return c.json({ items });
  });

  app.get("/v1/threads", auth, human, member, async (c) => {
    const rows = await listProjectThreads(db, {
      projectId: c.get("projectId"),
    });
    return c.json({
      items: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });

  app.post("/v1/threads", auth, human, member, async (c) => {
    const body = z
      .object({
        title: z.string().min(1),
        type: threadTypeSchema,
        trigger: z.string().min(1),
        duplicateSearchQuery: z.string().min(1),
        consensusType: consensusTypeSchema.optional(),
        humanRequired: z.boolean().optional(),
        target: proposalTargetSchema.optional(),
        sharedArtifactKind: sharedArtifactKindSchema.optional(),
        conflictCitationsChecked: z.boolean().optional(),
        parentThreadId: z.string().uuid().optional(),
        engineDiversity: engineDiversitySchema.optional(),
      })
      .parse(await c.req.json());
    const thread = await createThread(db, {
      projectId: c.get("projectId"),
      ownerId: c.get("participant").id,
      ...body,
    });
    return c.json(
      {
        id: thread.id,
        title: thread.title,
        type: thread.type,
        state: thread.state,
        consensusType: thread.consensusType,
        ownerParticipantId: thread.ownerParticipantId,
        createdAt: thread.createdAt.toISOString(),
      },
      201,
    );
  });

  app.get("/v1/search/threads", auth, human, member, async (c) => {
    const q = c.req.query("q") ?? "";
    const rows = await searchThreads(db, {
      projectId: c.get("projectId"),
      textQuery: q.trim() || undefined,
    });
    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        state: row.state,
      })),
    });
  });

  app.get("/v1/search/decisions", auth, human, member, async (c) => {
    const items = await listHumanAgreements(db, {
      projectId: c.get("projectId"),
      state: "active",
      q: c.req.query("q") ?? undefined,
    });
    return c.json({ items });
  });

  app.get("/v1/threads/:id", auth, human, member, async (c) => {
    try {
      const view = await getHumanThreadView(db, c.req.param("id"));
      assertProject(view.thread.projectId, c.get("projectId"));
      return c.json(view);
    } catch (error) {
      const mapped = jsonErrorStatus(error);
      if (mapped) {
        return c.json({ error: mapped.message }, mapped.status);
      }
      throw error;
    }
  });

  app.delete("/v1/threads/:id", auth, human, member, projectOwner, async (c) => {
    try {
      const view = await getHumanThreadView(db, c.req.param("id"));
      assertProject(view.thread.projectId, c.get("projectId"));
      await archiveThread(db, {
        threadId: c.req.param("id"),
        actorId: c.get("participant").id,
      });
      return c.body(null, 204);
    } catch (error) {
      const mapped = jsonErrorStatus(error);
      if (mapped) {
        return c.json({ error: mapped.message }, mapped.status);
      }
      throw error;
    }
  });

  app.delete(
    "/v1/threads/:id/proposals/:proposalId",
    auth,
    human,
    member,
    projectOwner,
    async (c) => {
      try {
        const view = await getHumanThreadView(db, c.req.param("id"));
        assertProject(view.thread.projectId, c.get("projectId"));
        await archiveProposal(db, {
          threadId: c.req.param("id"),
          proposalId: c.req.param("proposalId"),
          actorId: c.get("participant").id,
        });
        return c.body(null, 204);
      } catch (error) {
        const mapped = jsonErrorStatus(error);
        if (mapped) {
          return c.json({ error: mapped.message }, mapped.status);
        }
        throw error;
      }
    },
  );

  app.post("/v1/threads/:id/posts", auth, human, member, async (c) => {
    const body = z
      .object({
        type: postTypeSchema.refine((type) => type !== "declaration", {
          message: "宣言型の投稿は declare へ",
        }),
        body: z.string().min(1),
        rationale: z.string().optional(),
        blocking: z.boolean().optional(),
        proposalVersionId: z.string().uuid().optional(),
      })
      .parse(await c.req.json());
    const threadId = c.req.param("id");
    const view = await getHumanThreadView(db, threadId);
    assertProject(view.thread.projectId, c.get("projectId"));
    const post = await addPost(db, {
      threadId,
      authorId: c.get("participant").id,
      type: body.type,
      body: body.body,
      rationale: body.rationale,
      blocking: body.blocking,
      proposalVersionId: body.proposalVersionId,
    });
    if (body.type === "approval") {
      await maybeFinalizeUnanimous(db, { threadId });
    }
    return c.json(
      {
        id: post.id,
        type: post.type,
        body: post.body,
        createdAt: post.createdAt.toISOString(),
      },
      201,
    );
  });

  app.post("/v1/threads/:id/proposals", auth, human, member, async (c) => {
    const body = z.object({ content: z.string().min(1) }).parse(await c.req.json());
    const threadId = c.req.param("id");
    const view = await getHumanThreadView(db, threadId);
    assertProject(view.thread.projectId, c.get("projectId"));
    const { proposal, version } = await addProposal(db, {
      threadId,
      authorId: c.get("participant").id,
      content: body.content,
    });
    return c.json(
      {
        id: proposal.id,
        number: proposal.number,
        latestVersionId: version.id,
        versionNumber: version.versionNumber,
        content: version.content,
      },
      201,
    );
  });

  app.post("/v1/threads/:id/declare", auth, human, member, async (c) => {
    const payload = declarationPayloadSchema.parse(await c.req.json());
    const threadId = c.req.param("id");
    const view = await getHumanThreadView(db, threadId);
    assertProject(view.thread.projectId, c.get("projectId"));
    const { kind, ...rest } = payload;
    const result = await declare(db, {
      threadId,
      actorId: c.get("participant").id,
      kind,
      payload: rest,
    });
    return c.json(result);
  });

  app.post("/v1/threads/:id/pull-requests", auth, human, member, async (c) => {
    if (!options?.github) {
      return c.json({ error: "GitHub is not configured" }, 503);
    }
    const body = z.object({ url: z.string().url() }).parse(await c.req.json());
    const threadId = c.req.param("id");
    const view = await getHumanThreadView(db, threadId);
    assertProject(view.thread.projectId, c.get("projectId"));
    const row = await linkPullRequest(db, options.github, {
      threadId,
      actorId: c.get("participant").id,
      url: body.url,
    });
    return c.json({
      number: row.number,
      url: row.url,
      title: row.title,
      state: row.state,
    });
  });

  app.post("/v1/threads/:id/work-claims", auth, human, member, async (c) => {
    const body = z
      .object({ paths: z.array(z.string().min(1)).min(1) })
      .parse(await c.req.json());
    const threadId = c.req.param("id");
    const view = await getHumanThreadView(db, threadId);
    assertProject(view.thread.projectId, c.get("projectId"));
    const result = await claimWork(db, {
      threadId,
      participantId: c.get("participant").id,
      paths: body.paths,
    });
    return c.json(
      {
        id: result.claim.id,
        threadId: result.claim.threadId,
        paths: result.claim.paths,
        overlaps: result.overlaps,
      },
      201,
    );
  });

  app.post("/v1/threads/:id/work-claims/:claimId/release", auth, human, member, async (c) => {
    const threadId = c.req.param("id");
    const view = await getHumanThreadView(db, threadId);
    assertProject(view.thread.projectId, c.get("projectId"));
    const claim = await releaseWork(db, {
      claimId: c.req.param("claimId"),
      actorId: c.get("participant").id,
      threadId,
    });
    return c.json({ id: claim.id, active: claim.active });
  });

  app.get("/v1/project", auth, human, member, async (c) => {
    const summary = await getProjectSummary(db, c.get("projectId"));
    return c.json(summary);
  });

  app.patch("/v1/project", auth, human, member, async (c) => {
    const body = z
      .object({ repoUrl: z.string().nullable() })
      .parse(await c.req.json());
    const updated = await updateProject(db, {
      projectId: c.get("projectId"),
      actorId: c.get("participant").id,
      repoUrl: body.repoUrl,
    });
    return c.json({
      repoUrl: updated.repoUrl,
      githubOwner: updated.githubOwner,
      githubRepo: updated.githubRepo,
    });
  });

  app.get("/v1/participants", auth, human, member, async (c) => {
    const items = await listProjectParticipants(db, c.get("projectId"));
    return c.json({ items });
  });

  app.post("/v1/participants/:id/roles", auth, human, member, async (c) => {
    const body = z.object({ role: roleSchema }).parse(await c.req.json());
    const assignment = await assignRole(db, {
      projectId: c.get("projectId"),
      participantId: c.req.param("id"),
      role: body.role,
      actorId: c.get("participant").id,
    });
    return c.json(
      {
        id: assignment.id,
        participantId: assignment.participantId,
        role: assignment.role,
      },
      201,
    );
  });

  app.get("/v1/sessions", auth, human, member, async (c) => {
    const open = c.req.query("open");
    if (open !== "1" && open !== "true") {
      return c.json({ error: "open=1 を指定してください" }, 400);
    }
    const items = await listOpenSessions(db, c.get("projectId"));
    return c.json({ items });
  });

  app.get("/v1/agents/:id/sessions", auth, human, member, async (c) => {
    try {
      const items = await listAgentSessions(db, {
        projectId: c.get("projectId"),
        agentId: c.req.param("id"),
        actorId: c.get("participant").id,
      });
      if (!items) {
        return c.json({ error: "エージェントが見つかりません" }, 404);
      }
      return c.json({ items });
    } catch (error) {
      if (error instanceof PermissionDenied) {
        return c.json({ error: error.message }, 403);
      }
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  app.get("/v1/sessions/:id/chat-log", auth, human, async (c) => {
    const tailRaw = c.req.query("tailBytes") ?? c.req.query("tailChars");
    const fromStart =
      c.req.query("fromStart") === "1" || c.req.query("fromStart") === "true";
    const tailChars = tailRaw ? Number(tailRaw) : undefined;
    if (tailChars !== undefined && (!Number.isFinite(tailChars) || tailChars < 1)) {
      return c.json({ error: "tailBytes が不正です" }, 400);
    }
    try {
      const log = await getOwnerChatLog(db, {
        sessionId: c.req.param("id"),
        actorId: c.get("participant").id,
        tailChars,
        fromStart,
      });
      return c.json(log);
    } catch (error) {
      if (error instanceof PermissionDenied) {
        return c.json({ error: error.message }, 403);
      }
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  app.get("/v1/agreements", auth, human, member, async (c) => {
    const stateRaw = c.req.query("state");
    const state = stateRaw
      ? z.enum(AGREEMENT_STATES).parse(stateRaw)
      : undefined;
    const items = await listHumanAgreements(db, {
      projectId: c.get("projectId"),
      state,
    });
    return c.json({ items });
  });

  app.get("/v1/events", auth, human, member, async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return c.json({ error: "limit は 1〜200 です" }, 400);
    }
    const items = await listRecentEvents(db, {
      projectId: c.get("projectId"),
      limit,
    });
    return c.json({ items });
  });

  app.get("/v1/memory", auth, human, async (c) => {
    const items = await listActiveMemory(db, c.get("participant").id);
    return c.json({ items });
  });

  app.get("/v1/notes", auth, human, member, async (c) => {
    const q = c.req.query("q");
    const items = await searchNotes(db, {
      callerId: c.get("participant").id,
      projectId: c.get("projectId"),
      textQuery: q,
    });
    return c.json({ items });
  });

  app.post("/v1/notes", auth, human, member, async (c) => {
    const body = z
      .object({
        noteId: z.string().uuid().optional(),
        title: z.string().min(1),
        body: z.string().min(1),
        format: z.enum(["file", "journal"]),
        visibility: z.enum(["public", "private"]).optional(),
      })
      .parse(await c.req.json());
    try {
      const note = await writeNote(db, {
        authorParticipantId: c.get("participant").id,
        projectId: c.get("projectId"),
        noteId: body.noteId,
        title: body.title,
        body: body.body,
        format: body.format,
        visibility: body.visibility,
      });
      return c.json(note, 201);
    } catch (error) {
      if (error instanceof PermissionDenied) {
        return c.json({ error: error.message }, 403);
      }
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  app.get("/v1/notes/:id", auth, human, member, async (c) => {
    try {
      const note = await readNote(db, {
        noteId: c.req.param("id"),
        callerId: c.get("participant").id,
      });
      return c.json(note);
    } catch (error) {
      if (error instanceof PermissionDenied) {
        return c.json({ error: error.message }, 403);
      }
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  app.post("/v1/notes/:id/comments", auth, human, member, async (c) => {
    const body = z.object({ body: z.string().min(1) }).parse(await c.req.json());
    try {
      const comment = await commentNote(db, {
        noteId: c.req.param("id"),
        authorParticipantId: c.get("participant").id,
        body: body.body,
      });
      return c.json(comment, 201);
    } catch (error) {
      if (error instanceof PermissionDenied) {
        return c.json({ error: error.message }, 403);
      }
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });
}
