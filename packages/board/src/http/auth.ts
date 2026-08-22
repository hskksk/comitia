import type { InferSelectModel } from "drizzle-orm";
import { PROJECT_ID_HEADER } from "@comitia/shared";
import type { MiddlewareHandler } from "hono";
import { participants } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { authenticateToken } from "../domain/credentials.js";
import { GateViolation, PermissionDenied } from "../domain/errors.js";
import { getProject } from "../domain/helpers.js";
import { assertProjectMember, resolveHumanProjectId } from "../domain/memberships.js";

export type BoardVariables = {
  participant: InferSelectModel<typeof participants>;
  projectId: string;
  credentialProjectId: string | null;
};

export type BoardEnv = { Variables: BoardVariables };

function readBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function requireAuth(db: Db): MiddlewareHandler<BoardEnv> {
  return async (c, next) => {
    const token = readBearerToken(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const auth = await authenticateToken(db, token);
    if (!auth) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (auth.participant.kind === "agent" && auth.participant.archivedAt) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("participant", auth.participant);
    c.set("credentialProjectId", auth.projectId);
    if (auth.participant.kind !== "agent" && auth.projectId) {
      c.set("projectId", auth.projectId);
    }
    await next();
  };
}

export function requireHuman(): MiddlewareHandler<BoardEnv> {
  return async (c, next) => {
    if (c.get("participant").kind !== "human") {
      return c.json({ error: "human required" }, 403);
    }
    await next();
  };
}

export function requireAgent(): MiddlewareHandler<BoardEnv> {
  return async (c, next) => {
    if (c.get("participant").kind !== "agent") {
      return c.json({ error: "agent required" }, 403);
    }
    await next();
  };
}

export function requireProjectMember(
  db: Db,
  options?: { fromParam?: string },
): MiddlewareHandler<BoardEnv> {
  return async (c, next) => {
    const participant = c.get("participant");
    try {
      if (participant.kind === "agent") {
        const requested = options?.fromParam
          ? c.req.param(options.fromParam)
          : undefined;
        const projectId = requested || c.get("credentialProjectId");
        if (!projectId) {
          return c.json({ error: "project required" }, 400);
        }
        try {
          await assertProjectMember(db, projectId, participant.id);
        } catch (error) {
          if (error instanceof PermissionDenied) {
            return c.json({ error: error.message }, 403);
          }
          throw error;
        }
        c.set("projectId", projectId);
        await next();
        return;
      }
      const paramId = options?.fromParam
        ? c.req.param(options.fromParam)
        : undefined;
      const headerProjectId = c.req.header(PROJECT_ID_HEADER) ?? null;
      const projectId = await resolveHumanProjectId(db, {
        participantId: participant.id,
        credentialProjectId: c.get("credentialProjectId"),
        headerProjectId: paramId ? null : headerProjectId,
        explicitProjectId: paramId ?? null,
      });
      c.set("projectId", projectId);
      await next();
    } catch (error) {
      if (error instanceof GateViolation) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof PermissionDenied) {
        return c.json({ error: error.message }, 403);
      }
      throw error;
    }
  };
}

export function requireProjectOwner(db: Db): MiddlewareHandler<BoardEnv> {
  return async (c, next) => {
    const participant = c.get("participant");
    const projectId = c.get("projectId");
    if (!projectId) {
      return c.json({ error: "project required" }, 400);
    }
    try {
      const project = await getProject(db, projectId);
      if (project.ownerParticipantId !== participant.id) {
        return c.json({ error: "project owner required" }, 403);
      }
      await next();
    } catch (error) {
      if (error instanceof PermissionDenied) {
        return c.json({ error: error.message }, 403);
      }
      throw error;
    }
  };
}
