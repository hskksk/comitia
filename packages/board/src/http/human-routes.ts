import { HUMAN_DECLARATION_KINDS, declarationPayloadSchema } from "@comitia/shared";
import type { Hono } from "hono";
import type { Db } from "../db/types.js";
import { declare } from "../domain/declare.js";
import { NotFoundError } from "../domain/errors.js";
import {
  getHumanThreadView,
  listJudgmentQueue,
  listNonblockingInbox,
  listProjectThreads,
} from "../domain/human-views.js";
import { linkPullRequest, refreshStalePullRequests } from "../domain/pull-requests.js";
import type { GitHubClient } from "../github/types.js";
import { z } from "zod";
import { type BoardEnv, requireAuth, requireOwner } from "./auth.js";

function assertProject(viewProjectId: string, requestProjectId: string) {
  if (viewProjectId !== requestProjectId) {
    throw new NotFoundError("スレッドが見つかりません");
  }
}

export function registerHumanRoutes(
  app: Hono<BoardEnv>,
  db: Db,
  options?: { github?: GitHubClient },
) {
  const auth = requireAuth(db);
  const owner = requireOwner();

  app.get("/v1/me", auth, owner, (c) => {
    const participant = c.get("participant");
    return c.json({
      participant: {
        id: participant.id,
        kind: participant.kind,
        displayName: participant.displayName,
      },
      projectId: c.get("projectId"),
    });
  });

  app.get("/v1/queue", auth, owner, async (c) => {
    const items = await listJudgmentQueue(db, {
      projectId: c.get("projectId"),
    });
    return c.json({ items });
  });

  app.get("/v1/inbox", auth, owner, async (c) => {
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

  app.get("/v1/threads", auth, owner, async (c) => {
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

  app.get("/v1/threads/:id", auth, owner, async (c) => {
    const view = await getHumanThreadView(db, c.req.param("id"));
    assertProject(view.thread.projectId, c.get("projectId"));
    return c.json(view);
  });

  app.post("/v1/threads/:id/declare", auth, owner, async (c) => {
    const rawPayload = await c.req.json();
    const rawKind =
      typeof rawPayload === "object" && rawPayload !== null
        ? (rawPayload as { kind?: unknown }).kind
        : undefined;
    if (
      typeof rawKind !== "string" ||
      !(HUMAN_DECLARATION_KINDS as readonly string[]).includes(rawKind)
    ) {
      return c.json({ error: "この宣言は人間 UI からは行えません" }, 403);
    }
    const payload = declarationPayloadSchema.parse(rawPayload);
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

  app.post("/v1/threads/:id/pull-requests", auth, owner, async (c) => {
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
}
