import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z, ZodError } from "zod";
import type { TickType } from "@comitia/shared";
import { sessions } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { addTokenUsage } from "../domain/activity.js";
import { bootstrapBoard, registerAgent } from "../domain/bootstrap.js";
import { DomainError, PermissionDenied } from "../domain/errors.js";
import { getSessionById } from "../domain/sessions.js";
import { createBoardToolRuntime } from "../mcp/create-server.js";
import {
  type BoardEnv,
  requireAgent,
  requireAuth,
  requireOwner,
} from "./auth.js";

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
}) {
  const { db } = input;
  const app = new Hono<BoardEnv>();
  const auth = requireAuth(db);
  const owner = requireOwner();
  const agent = requireAgent();

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

  app.post("/v1/agents", auth, owner, async (c) => {
    const body = z
      .object({
        displayName: z.string().min(1),
        engine: z.string(),
      })
      .parse(await c.req.json());
    const participant = c.get("participant");
    const result = await registerAgent(db, {
      ownerParticipantId: participant.id,
      displayName: body.displayName,
      engine: body.engine,
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
    const projectId = c.get("projectId");
    const name = c.req.param("name");
    const args = (await c.req.json()) as Record<string, unknown>;
    const runtime = createBoardToolRuntime({
      db,
      participantId: participant.id,
      projectId,
    });
    const result = await runtime.callTool(name, args);
    if (result.isError) {
      const message = result.content[0]?.text ?? "error";
      const status = message.startsWith("未知のツール") ? 404 : 400;
      return c.json({ error: message }, status);
    }
    return c.json(runtime.parseJsonContent(result));
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

  return app;
}
