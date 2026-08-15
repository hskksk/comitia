import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Role, type Message } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import {
  createTick,
  type Tick,
  type TickType,
} from "@comitia/shared";
import { agentCredentials } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { NotFoundError } from "../domain/errors.js";
import {
  findOpenSession,
  prepareSessionStart,
} from "../domain/sessions.js";
import {
  insertTick,
  listQueuedTicks,
  markTickDelivered,
  tickFromRow,
} from "../domain/ticks.js";
import type { Relay } from "./relay.js";

export interface SendTickInput {
  participantId: string;
  type: TickType;
}

export interface SendTickResult {
  tickId: string;
  sessionId?: string;
  status: "delivered" | "queued";
}

const clientFactory = new ClientFactory();

function tickToMessage(tick: Tick): Message {
  const metadata: Record<string, string> = {
    tickId: tick.id,
    tickType: tick.type,
    issuedAt: tick.issuedAt,
  };
  if (tick.sessionId) {
    metadata.sessionId = tick.sessionId;
  }

  return {
    messageId: randomUUID(),
    contextId: "",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: "text", value: tick.type },
        metadata,
        filename: "",
        mediaType: "text/plain",
      },
    ],
    metadata,
    extensions: [],
    referenceTaskIds: [],
  };
}

function isOfflineError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("503") ||
      msg.includes("offline") ||
      msg.includes("agent offline")
    ) {
      return true;
    }
  }
  return false;
}

async function getAgentCredential(db: Db, participantId: string) {
  const [cred] = await db
    .select()
    .from(agentCredentials)
    .where(eq(agentCredentials.participantId, participantId))
    .limit(1);
  if (!cred) {
    throw new NotFoundError("エージェント資格情報が見つかりません");
  }
  return cred;
}

async function deliverTick(
  relay: Relay,
  agentId: string,
  tick: Tick,
): Promise<boolean> {
  if (!relay.isConnected(agentId) || !relay.baseUrl) {
    return false;
  }

  const agentBaseUrl = `${relay.baseUrl}/agents/${agentId}/`;
  try {
    const client = await clientFactory.createFromUrl(agentBaseUrl);
    await client.sendMessage({
      tenant: "",
      message: tickToMessage(tick),
      configuration: {
        acceptedOutputModes: ["text/plain"],
        taskPushNotificationConfig: undefined,
        returnImmediately: false,
      },
      metadata: undefined,
    });
    return true;
  } catch (error) {
    if (isOfflineError(error)) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("503")) {
      return false;
    }
    throw error;
  }
}

export async function sendTick(
  db: Db,
  relay: Relay,
  input: SendTickInput,
): Promise<SendTickResult> {
  const cred = await getAgentCredential(db, input.participantId);
  let sessionId: string | undefined;

  if (input.type === "session.start") {
    const session = await prepareSessionStart(db, {
      participantId: input.participantId,
      projectId: cred.projectId,
    });
    sessionId = session.id;
  } else {
    const open = await findOpenSession(db, {
      participantId: input.participantId,
      projectId: cred.projectId,
    });
    sessionId = open?.id;
  }

  const tick = createTick(input.type, sessionId ? { sessionId } : {});
  const delivered = await deliverTick(relay, input.participantId, tick);
  await insertTick(db, {
    tick,
    participantId: input.participantId,
    status: delivered ? "delivered" : "queued",
  });

  return {
    tickId: tick.id,
    ...(sessionId ? { sessionId } : {}),
    status: delivered ? "delivered" : "queued",
  };
}

export async function flushMailbox(
  db: Db,
  relay: Relay,
  participantId: string,
): Promise<void> {
  const queued = await listQueuedTicks(db, participantId);
  for (const row of queued) {
    const ok = await deliverTick(relay, participantId, tickFromRow(row));
    if (!ok) {
      break;
    }
    await markTickDelivered(db, row.id);
  }
}
