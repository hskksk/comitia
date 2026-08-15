import { HUMAN_DECLARATION_KINDS, declarationPayloadSchema } from "@comitia/shared";
import type { Hono } from "hono";
import type { Db } from "../db/types.js";
import { declare } from "../domain/declare.js";
import { NotFoundError, PermissionDenied } from "../domain/errors.js";
import {
  getHumanThreadView,
  listJudgmentQueue,
  listNonblockingInbox,
  listProjectThreads,
} from "../domain/human-views.js";
import { type BoardEnv, requireAuth, requireOwner } from "./auth.js";

function assertProject(viewProjectId: string, requestProjectId: string) {
  if (viewProjectId !== requestProjectId) {
    throw new NotFoundError("スレッドが見つかりません");
  }
}

export function registerHumanRoutes(app: Hono<BoardEnv>, db: Db) {
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
    const items = await listNonblockingInbox(db, {
      projectId: c.get("projectId"),
    });
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
    const payload = declarationPayloadSchema.parse(await c.req.json());
    if (!(HUMAN_DECLARATION_KINDS as readonly string[]).includes(payload.kind)) {
      throw new PermissionDenied("この宣言は人間 UI からは行えません");
    }
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
}
