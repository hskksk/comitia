import { Hono } from "hono";
import { GATEWAY } from "@comitia/shared";
import type { DbClient } from "../db/types.js";
import { runScheduler, utcMinutes } from "../gateway/scheduler.js";
import { sendTick, flushMailbox } from "../gateway/send-tick.js";
import {
  expireStaleConnections,
  maybeSendEndWarning,
  touchConnection,
} from "../gateway/health.js";
import { findUndigestedSession, interruptStaleSessions } from "../domain/sessions.js";
import { evaluateTimedConsensus } from "../domain/timed-consensus.js";
import { recordEvent } from "../domain/events.js";

/**
 * Cron job routes for serverless background tasks.
 *
 * These endpoints should be called periodically (e.g., every 15 seconds)
 * by a cron service like Railway Cron, EasyCron, or similar.
 */

export function registerCronRoutes(app: Hono, input: { db: DbClient }) {
  const { db } = input;

  // Main loop tick - should be called every 15 seconds
  app.post("/cron/tick", async (c) => {
    const authToken = c.req.header("x-cron-secret");
    const expectedToken = process.env.CRON_SECRET;

    if (!expectedToken || authToken !== expectedToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const now = new Date();

      // Find and interrupt stale sessions
      const staleSessions = await interruptStaleSessions(db, now);

      // Expire stale connections
      await expireStaleConnections(db, now);

      // Evaluate timed consensus
      await evaluateTimedConsensus(db, now);

      // Send pending ticks
      const undigested = await findUndigestedSession(db);
      if (undigested) {
        const result = await sendTick(db, {
          participantId: undigested.participantId,
          type: undigested.tickType as any,
        });
        await recordEvent(db, {
          type: "sent",
          participantId: undigested.participantId,
          tickId: result.tickId,
        });
      }

      // Run scheduler
      const minutes = utcMinutes(now);
      await runScheduler(db, minutes);

      return c.json({
        ok: true,
        staleSessions,
        now: now.toISOString(),
      });
    } catch (error) {
      console.error("Cron tick failed:", error);
      return c.json(
        { error: "Internal server error", message: String(error) },
        500
      );
    }
  });

  // Health check - monitor connection health
  app.post("/cron/health-check", async (c) => {
    const authToken = c.req.header("x-cron-secret");
    const expectedToken = process.env.CRON_SECRET;

    if (!expectedToken || authToken !== expectedToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const connections = await db.query.agentConnections.findMany();
      const warnings: string[] = [];

      for (const conn of connections) {
        const warning = await maybeSendEndWarning(db, conn, new Date());
        if (warning) {
          warnings.push(warning);
        }
      }

      return c.json({
        ok: true,
        connectionsChecked: connections.length,
        warningsSent: warnings.length,
      });
    } catch (error) {
      console.error("Health check failed:", error);
      return c.json(
        { error: "Internal server error", message: String(error) },
        500
      );
    }
  });

  // Flush mailbox - process queued messages
  app.post("/cron/flush-mailbox", async (c) => {
    const authToken = c.req.header("x-cron-secret");
    const expectedToken = process.env.CRON_SECRET;

    if (!expectedToken || authToken !== expectedToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const result = await flushMailbox(db);
      return c.json({
        ok: true,
        messagesFlushed: result.count,
      });
    } catch (error) {
      console.error("Mailbox flush failed:", error);
      return c.json(
        { error: "Internal server error", message: String(error) },
        500
      );
    }
  });
}
