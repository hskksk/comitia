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
import {
  parseTickFromMetadata,
  type Tick,
  type TunnelControl,
  type TunnelHttpRequest,
  type TunnelHttpResponse,
} from "@comitia/shared";
import WebSocket from "ws";

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

export interface TestAdapterOptions {
  agentId: string;
  localPort?: number;
  relayBaseUrl: string;
}

export interface TestAdapter {
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

export async function createTestAdapter(
  options: TestAdapterOptions,
): Promise<TestAdapter> {
  const agentId = options.agentId;
  const tickExecutor = new TickExecutor();
  const publicBaseUrl = `${options.relayBaseUrl}/agents/${agentId}/`;
  let tunnelWs: WebSocket | null = null;

  function buildAgentCard(): AgentCard {
    return {
      name: `comitia-adapter-${agentId}`,
      description: "Comitia board test tick adapter",
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
    throw new Error("local A2A server address is unavailable");
  }
  const localPort = addr.port;
  const localBaseUrl = `http://127.0.0.1:${localPort}`;

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
        const msg = JSON.parse(String(data)) as
          | TunnelHttpRequest
          | TunnelControl;
        if (msg.type === "ping") {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
          return;
        }
        if (msg.type !== "http" || !("id" in msg) || !msg.id) {
          return;
        }
        void handleTunnelRequest(ws, msg);
      } catch {
        // ignore malformed tunnel messages
      }
    });
  }

  return {
    agentId,
    localPort,
    localBaseUrl,

    async connect(relayWsUrl: string): Promise<void> {
      const ws = new WebSocket(relayWsUrl);
      tunnelWs = ws;

      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => {
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

export function buildRelayWsUrl(
  relayBaseUrl: string,
  agentId: string,
  token: string,
): string {
  const parsed = new URL(relayBaseUrl);
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${parsed.host}/tunnel?agentId=${encodeURIComponent(agentId)}&token=${encodeURIComponent(token)}`;
}
