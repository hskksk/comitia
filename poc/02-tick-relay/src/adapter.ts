import { createServer, type Server } from "node:http";
import express from "express";
import { TaskState, type AgentCard } from "@a2a-js/sdk";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  restHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import WebSocket from "ws";
import { POC_RELAY_TOKEN } from "./relay.js";
import { parseTickFromMetadata, type Tick } from "./tick.js";

/** HTTP-over-WebSocket 転送メッセージ（relay.ts と同一形式） */
interface TunnelHttpRequest {
  type: "http";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string;
}

interface TunnelHttpResponse {
  type: "http-response";
  id: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
}

/** トンネル中継部の行数計測用マーカー（コメント行にのみ使用） */
class TickExecutor implements AgentExecutor {
  private readonly receivedTicks: Tick[] = [];

  getReceivedTicks(): Tick[] {
    return [...this.receivedTicks];
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const tick = parseTickFromMetadata(
      userMessage.metadata as Record<string, unknown> | undefined,
    );

    if (tick) {
      this.receivedTicks.push(tick);
      console.log(
        `[adapter] tick 受信: id=${tick.id} type=${tick.type} at=${tick.issuedAt}`,
      );
    } else {
      console.log("[adapter] tick 以外のメッセージを受信（metadata なし）");
    }

    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const timestamp = new Date().toISOString();

    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          message: undefined,
          timestamp,
        },
        artifacts: [],
        history: [userMessage],
        metadata: undefined,
      }),
    );

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp,
        },
        metadata: undefined,
      }),
    );

    eventBus.finished();
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: "",
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }),
    );
    eventBus.finished();
  }
}

export interface AdapterOptions {
  agentId?: string;
  localPort?: number;
  /** リレーの HTTP ベース URL（Agent Card の supportedInterfaces に載せる） */
  relayBaseUrl: string;
}

export interface Adapter {
  readonly agentId: string;
  readonly localPort: number;
  readonly localBaseUrl: string;
  connect(relayWsUrl: string): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getReceivedTicks(): Tick[];
  getReceivedTickIds(): string[];
  close(): Promise<void>;
}

/** ユーザー環境側アダプタ（A2A サーバ + リレー WS トンネル） */
export async function createAdapter(
  options: AdapterOptions,
): Promise<Adapter> {
  const agentId = options.agentId ?? "mika";
  const tickExecutor = new TickExecutor();
  const publicBaseUrl = `${options.relayBaseUrl}/agents/${agentId}/`;
  let tunnelWs: WebSocket | null = null;

  function buildAgentCard(): AgentCard {
    return {
      name: `comitia-adapter-${agentId}`,
      description: "Comitia PoC-2 tick アダプタ",
      supportedInterfaces: [
        {
          url: publicBaseUrl,
          protocolBinding: "HTTP+JSON",
          tenant: "",
          protocolVersion: "1.0",
        },
      ],
      provider: undefined,
      version: "0.0.1",
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extensions: [],
      },
      securitySchemes: {},
      securityRequirements: [],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [],
      signatures: [],
    };
  }

  const agentCard = buildAgentCard();
  const taskStore = new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    tickExecutor,
  );

  const app = express();
  app.use(
    "/.well-known/agent-card.json",
    agentCardHandler({ agentCardProvider: requestHandler }),
  );
  app.use(
    "/",
    restHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  const httpServer: Server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(options.localPort ?? 0, () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === "string") {
    throw new Error("ローカル A2A サーバのアドレスを取得できません");
  }
  const localPort = addr.port;
  const localBaseUrl = `http://127.0.0.1:${localPort}`;

  // @@TUNNEL_RELAY_BEGIN@@
  async function handleTunnelRequest(
    ws: WebSocket,
    msg: TunnelHttpRequest,
  ): Promise<void> {
    const hopByHop = new Set([
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailers",
      "transfer-encoding",
      "upgrade",
      "host",
    ]);

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(msg.headers)) {
      if (hopByHop.has(key.toLowerCase())) {
        continue;
      }
      if (typeof value === "string") {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value.join(", ");
      }
    }

    const targetUrl = `${localBaseUrl}${msg.path}`;
    const body = msg.body ? Buffer.from(msg.body, "base64") : undefined;

    try {
      const response = await fetch(targetUrl, {
        method: msg.method,
        headers,
        body,
      });

      const responseBuffer = Buffer.from(await response.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "transfer-encoding") {
          responseHeaders[key] = value;
        }
      });

      const tunnelRes: TunnelHttpResponse = {
        type: "http-response",
        id: msg.id,
        status: response.status,
        headers: responseHeaders,
        body:
          responseBuffer.length > 0
            ? responseBuffer.toString("base64")
            : undefined,
      };

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(tunnelRes));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const tunnelRes: TunnelHttpResponse = {
        type: "http-response",
        id: msg.id,
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: Buffer.from(`Tunnel fetch error: ${message}`).toString("base64"),
      };
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(tunnelRes));
      }
    }
  }

  function attachTunnelHandlers(ws: WebSocket): void {
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as TunnelHttpRequest;
        if (msg.type !== "http" || !msg.id) {
          return;
        }
        void handleTunnelRequest(ws, msg);
      } catch {
        // 不正メッセージは無視
      }
    });
  }
  // @@TUNNEL_RELAY_END@@

  return {
    agentId,
    localPort,
    localBaseUrl,

    async connect(relayWsUrl: string): Promise<void> {
      const ws = new WebSocket(relayWsUrl);
      tunnelWs = ws;

      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => {
          console.log(`[adapter] リレーへ接続: ${relayWsUrl}`);
          attachTunnelHandlers(ws);
          resolve();
        });
        ws.once("error", reject);
      });
    },

    disconnect(): void {
      if (tunnelWs) {
        tunnelWs.close();
        tunnelWs = null;
        console.log("[adapter] リレーから切断（シミュレーション）");
      }
    },

    isConnected(): boolean {
      return tunnelWs !== null && tunnelWs.readyState === WebSocket.OPEN;
    },

    getReceivedTicks(): Tick[] {
      return tickExecutor.getReceivedTicks();
    },

    getReceivedTickIds(): string[] {
      return tickExecutor.getReceivedTicks().map((t) => t.id);
    },

    async close(): Promise<void> {
      if (tunnelWs) {
        tunnelWs.close();
        tunnelWs = null;
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/** リレー WS URL を組み立てる */
export function buildRelayWsUrl(
  relayBaseUrl: string,
  agentId: string,
  token = POC_RELAY_TOKEN,
): string {
  const parsed = new URL(relayBaseUrl);
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${parsed.host}/tunnel?agentId=${encodeURIComponent(agentId)}&token=${encodeURIComponent(token)}`;
}
