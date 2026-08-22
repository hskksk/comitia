import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z, ZodError } from "zod";
import { PROJECT_ID_HEADER, type TickType } from "@comitia/shared";
import { agentConnections, agentCredentials, sessions } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { addTokenUsage } from "../domain/activity.js";
import { registerHuman } from "../domain/accounts.js";
import { bootstrapBoard, registerAgent } from "../domain/bootstrap.js";
import {
  DomainError,
  NotFoundError,
  PermissionDenied,
} from "../domain/errors.js";
import { getProject } from "../domain/helpers.js";
import { issueAgentGithubCredentials } from "../domain/github-credentials.js";
import { resolveHumanProjectId, resolveUniqueMembershipProjectId } from "../domain/memberships.js";
import { agentBelongsToProject } from "../domain/owned-agents.js";
import { findOpenSession, getSessionById } from "../domain/sessions.js";
import type { GitHubClient } from "../github/types.js";
import { maybeSendEndWarning } from "../gateway/health.js";
import { createBoardToolRuntime } from "../mcp/create-server.js";
import {
  type BoardEnv,
  requireAgent,
  requireAuth,
  requireHuman,
  requireProjectMember,
} from "./auth.js";
import { registerGithubAuthRoutes } from "./github-auth-routes.js";
import { registerGithubRoutes } from "./github-routes.js";
import { registerHumanRoutes } from "./human-routes.js";

export type BoardGateway = {
  sendTick: (input: {
    participantId: string;
    type: TickType;
  }) => Promise<{
    tickId: string;
    sessionId?: string;
    status: "delivered" | "queued";
  }>;
};

export function createBoardApp(input: {
  db: Db;
  getGateway?: () => BoardGateway | undefined;
  github?: GitHubClient;
  githubPublicBaseUrl?: string;
  webhookSecret?: string;
  githubOAuth?: {
    enabled: boolean;
    appSlug?: string;
    clientId?: string;
  };
}) {
  const { db } = input;
  const app = new Hono<BoardEnv>();
  const auth = requireAuth(db);
  const human = requireHuman();
  const member = requireProjectMember(db);
  const agent = requireAgent();

  registerGithubRoutes(app, {
    db,
    github: input.github,
    webhookSecret: input.webhookSecret,
    publicBaseUrl: input.githubPublicBaseUrl,
  });
  registerGithubAuthRoutes(app, {
    db,
    github: input.github,
    oauthEnabled: input.githubOAuth?.enabled ?? false,
    appSlug: input.githubOAuth?.appSlug,
    clientId: input.githubOAuth?.clientId,
    publicBaseUrl: input.githubPublicBaseUrl,
  });

  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json(
        { error: error.issues.map((issue) => issue.message).join("; ") },
        400,
      );
    }
    if (error instanceof DomainError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "internal error" }, 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.post("/v1/init", async (c) => {
    const body = z
      .object({
        ownerDisplayName: z.string().min(1),
        projectName: z.string().min(1),
        repoUrl: z.string().url().optional(),
      })
      .parse(await c.req.json());
    const result = await bootstrapBoard(db, body);
    return c.json(
      {
        ownerId: result.owner.id,
        projectId: result.project.id,
        ownerToken: result.ownerToken,
      },
      201,
    );
  });

  app.post("/v1/register", async (c) => {
    const body = z
      .object({ displayName: z.string().min(1) })
      .parse(await c.req.json());
    const result = await registerHuman(db, { displayName: body.displayName });
    return c.json(
      {
        participantId: result.human.id,
        token: result.token,
      },
      201,
    );
  });

  app.post("/v1/agents", auth, human, async (c) => {
    const body = z
      .object({
        displayName: z.string().min(1),
        engine: z.string(),
        projectId: z.string().uuid().optional(),
        role: z
          .enum(["facilitator", "proposer", "reviewer", "recorder", "executor"])
          .optional(),
      })
      .parse(await c.req.json());
    const participant = c.get("participant");
    const projectId = await resolveHumanProjectId(db, {
      participantId: participant.id,
      credentialProjectId: c.get("credentialProjectId"),
      headerProjectId: c.req.header(PROJECT_ID_HEADER) ?? null,
      explicitProjectId: body.projectId ?? null,
    });
    const result = await registerAgent(db, {
      ownerParticipantId: participant.id,
      projectId,
      displayName: body.displayName,
      engine: body.engine,
      role: body.role,
    });
    return c.json(
      {
        agentId: result.agent.id,
        projectId: result.projectId,
        agentToken: result.agentToken,
      },
      201,
    );
  });

  app.post("/v1/tools/:name", auth, agent, async (c) => {
    const participant = c.get("participant");
    const name = c.req.param("name");
    const args = (await c.req.json()) as Record<string, unknown>;
    const runtime = createBoardToolRuntime({
      db,
      participantId: participant.id,
      github: input.github,
    });
    const result = await runtime.callTool(name, args);
    if (result.isError) {
      const message = result.content[0]?.text ?? "error";
      const status = message.startsWith("未知のツール") ? 404 : 400;
      return c.json({ error: message }, status);
    }
    const gateway = input.getGateway?.();
    if (gateway) {
      const open = await findOpenSession(db, {
        participantId: participant.id,
      });
      if (open) {
        await maybeSendEndWarning(db, gateway.sendTick, {
          participantId: participant.id,
          sessionId: open.id,
        });
      }
    }
    return c.json(runtime.parseJsonContent(result));
  });

  app.get("/v1/agents/:id/connection", auth, human, member, async (c) => {
    const agentId = c.req.param("id");
    const projectId = c.get("projectId");
    if (!projectId) {
      return c.json({ error: "project required" }, 400);
    }
    if (!(await agentBelongsToProject(db, agentId, projectId))) {
      throw new NotFoundError("エージェントが見つかりません");
    }
    const [cred] = await db
      .select()
      .from(agentCredentials)
      .where(eq(agentCredentials.participantId, agentId))
      .limit(1);
    if (!cred) {
      throw new NotFoundError("エージェントが見つかりません");
    }
    const [conn] = await db
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.participantId, agentId))
      .limit(1);
    if (!conn) {
      throw new NotFoundError("エージェント接続が見つかりません");
    }
    return c.json({
      status: conn.status,
      lastSeenAt: conn.lastSeenAt ? conn.lastSeenAt.toISOString() : null,
    });
  });

  app.get("/v1/me/project", auth, agent, async (c) => {
    const participant = c.get("participant");
    const projectId =
      (await resolveUniqueMembershipProjectId(db, participant.id)) ??
      c.get("credentialProjectId");
    if (!projectId) {
      return c.json({ error: "project required" }, 400);
    }
    const project = await getProject(db, projectId);
    return c.json({
      repoUrl: project.repoUrl,
      githubOwner: project.githubOwner,
      githubRepo: project.githubRepo,
    });
  });

  app.post("/v1/me/github-credentials", auth, agent, async (c) => {
    const participant = c.get("participant");
    let requestedProjectId: string | undefined;
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await c.req.json().catch(() => ({}));
      const parsed = z
        .object({ projectId: z.string().min(1).optional() })
        .parse(body ?? {});
      requestedProjectId = parsed.projectId;
    }
    const result = await issueAgentGithubCredentials(db, input.github, {
      participantId: participant.id,
      requestedProjectId,
      credentialProjectId: c.get("credentialProjectId"),
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json({
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      owner: result.owner,
      repo: result.repo,
      repoUrl: result.repoUrl,
    });
  });

  app.post("/v1/me/request-session", auth, agent, async (c) => {
    const participant = c.get("participant");
    const gateway = input.getGateway?.();
    if (!gateway) {
      return c.json({ error: "tick gateway is unavailable" }, 503);
    }
    const result = await gateway.sendTick({
      participantId: participant.id,
      type: "session.start",
    });
    return c.json({
      sessionId: result.sessionId,
      tickId: result.tickId,
      status: result.status,
    });
  });

  app.post("/v1/agents/:id/request-session", auth, human, member, async (c) => {
    const agentId = c.req.param("id");
    const projectId = c.get("projectId");
    if (!projectId || !(await agentBelongsToProject(db, agentId, projectId))) {
      return c.json({ error: "エージェントが見つかりません" }, 404);
    }
    const [cred] = await db
      .select()
      .from(agentCredentials)
      .where(eq(agentCredentials.participantId, agentId))
      .limit(1);
    if (!cred) {
      return c.json({ error: "エージェントが見つかりません" }, 404);
    }
    const gateway = input.getGateway?.();
    if (!gateway) {
      return c.json({ error: "tick gateway is unavailable" }, 503);
    }
    const result = await gateway.sendTick({
      participantId: agentId,
      type: "session.start",
    });
    return c.json({
      sessionId: result.sessionId,
      tickId: result.tickId,
      status: result.status,
    });
  });

  app.post("/v1/sessions/:id/chat-log", auth, agent, async (c) => {
    const participant = c.get("participant");
    const sessionId = c.req.param("id");
    const body = z.object({ chunk: z.string() }).parse(await c.req.json());
    const session = await getSessionById(db, sessionId);
    if (session.participantId !== participant.id) {
      throw new PermissionDenied("セッションの所有者ではありません");
    }
    await db
      .update(sessions)
      .set({ chatLog: sql`${sessions.chatLog} || ${body.chunk}` })
      .where(eq(sessions.id, sessionId));
    return c.json({ ok: true });
  });

  app.post("/v1/sessions/:id/token-usage", auth, agent, async (c) => {
    const participant = c.get("participant");
    const sessionId = c.req.param("id");
    const body = z.object({ tokens: z.number() }).parse(await c.req.json());
    const session = await getSessionById(db, sessionId);
    if (session.participantId !== participant.id) {
      throw new PermissionDenied("セッションの所有者ではありません");
    }
    const remaining = await addTokenUsage(db, sessionId, body.tokens);
    return c.json({ remaining_budget: remaining });
  });

  registerHumanRoutes(app, db, {
    github: input.github,
  });

  return app;
}
