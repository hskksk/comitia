import type { InferSelectModel } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { participants } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { authenticateToken } from "../domain/credentials.js";

export type BoardVariables = {
  participant: InferSelectModel<typeof participants>;
  projectId: string;
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
    c.set("participant", auth.participant);
    c.set("projectId", auth.projectId);
    await next();
  };
}

export function requireOwner(): MiddlewareHandler<BoardEnv> {
  return async (c, next) => {
    if (c.get("participant").kind !== "human") {
      return c.json({ error: "owner required" }, 403);
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
