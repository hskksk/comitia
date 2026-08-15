import { randomUUID } from "node:crypto";
import { Role, type Message } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { createTick, type Tick, type TickType } from "./tick.js";

export type TickDeliveryStatus = "delivered" | "queued" | "flushed";

export interface TickDeliveryLog {
  agentId: string;
  tickId: string;
  tickType: TickType;
  status: TickDeliveryStatus;
  at: string;
}

interface MailboxEntry {
  tick: Tick;
}

export interface GatewayOptions {
  relayBaseUrl: string;
}

export interface SendTickResult {
  tickId: string;
  status: "delivered" | "queued";
}

export interface Gateway {
  sendTick(agentId: string, tickType: TickType): Promise<SendTickResult>;
  flushMailbox(agentId: string): Promise<void>;
  getDeliveryLogs(): TickDeliveryLog[];
  getMailboxSize(agentId: string): number;
}

/** tick を A2A Message に載せる */
function tickToMessage(tick: Tick): Message {
  return {
    messageId: randomUUID(),
    contextId: "",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: "text", value: tick.type },
        metadata: {
          tickId: tick.id,
          tickType: tick.type,
          issuedAt: tick.issuedAt,
        },
        filename: "",
        mediaType: "text/plain",
      },
    ],
    metadata: {
      tickId: tick.id,
      tickType: tick.type,
      issuedAt: tick.issuedAt,
    },
    extensions: [],
    referenceTaskIds: [],
  };
}

/** 503 相当（オフライン）かどうか */
function isOfflineError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("503") || msg.includes("offline") || msg.includes("agent offline")) {
      return true;
    }
  }
  return false;
}

/** サービス側ゲートウェイ（tick 送信 + メールボックス） */
export function createGateway(options: GatewayOptions): Gateway {
  const mailboxes = new Map<string, MailboxEntry[]>();
  const deliveryLogs: TickDeliveryLog[] = [];
  const clientFactory = new ClientFactory();

  function logDelivery(
    agentId: string,
    tick: Tick,
    status: TickDeliveryStatus,
  ): void {
    const entry: TickDeliveryLog = {
      agentId,
      tickId: tick.id,
      tickType: tick.type,
      status,
      at: new Date().toISOString(),
    };
    deliveryLogs.push(entry);
    console.log(
      `[gateway] tick ${status}: agent=${agentId} id=${tick.id} type=${tick.type}`,
    );
  }

  async function deliverTick(agentId: string, tick: Tick): Promise<boolean> {
    const agentBaseUrl = `${options.relayBaseUrl}/agents/${agentId}/`;
    try {
      const client = await clientFactory.createFromUrl(agentBaseUrl);
      const result = await client.sendMessage({
        tenant: "",
        message: tickToMessage(tick),
        configuration: {
          acceptedOutputModes: ["text/plain"],
          taskPushNotificationConfig: undefined,
          returnImmediately: false,
        },
        metadata: undefined,
      });

      const taskId =
        typeof result === "object" && "id" in result ? result.id : "message";
      console.log(`[gateway] A2A 応答: taskId=${taskId}`);
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

  return {
    async sendTick(agentId: string, tickType: TickType): Promise<SendTickResult> {
      const tick = createTick(tickType);
      const ok = await deliverTick(agentId, tick);
      if (ok) {
        logDelivery(agentId, tick, "delivered");
        return { tickId: tick.id, status: "delivered" };
      }

      const mailbox = mailboxes.get(agentId) ?? [];
      mailbox.push({ tick });
      mailboxes.set(agentId, mailbox);
      logDelivery(agentId, tick, "queued");
      return { tickId: tick.id, status: "queued" };
    },

    async flushMailbox(agentId: string): Promise<void> {
      const mailbox = mailboxes.get(agentId);
      if (!mailbox || mailbox.length === 0) {
        return;
      }

      while (mailbox.length > 0) {
        const entry = mailbox[0];
        const ok = await deliverTick(agentId, entry.tick);
        if (!ok) {
          break;
        }
        mailbox.shift();
        logDelivery(agentId, entry.tick, "flushed");
      }

      if (mailbox.length === 0) {
        mailboxes.delete(agentId);
      }
    },

    getDeliveryLogs(): TickDeliveryLog[] {
      return [...deliveryLogs];
    },

    getMailboxSize(agentId: string): number {
      return mailboxes.get(agentId)?.length ?? 0;
    },
  };
}
