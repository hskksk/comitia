import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import {
  type TunnelHttpRequest,
  type TunnelHttpResponse,
} from "@comitia/shared";
import { WebSocket, WebSocketServer } from "ws";

interface PendingRequest {
  resolve: (response: TunnelHttpResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface AgentConnection {
  ws: WebSocket;
  pending: Map<string, PendingRequest>;
}

export interface RelayConnectionEvent {
  agentId: string;
}

export interface RelayOptions {
  authenticate: (
    agentId: string,
    token: string,
  ) => boolean | Promise<boolean>;
  onConnect?: (event: RelayConnectionEvent) => void | Promise<void>;
  onDisconnect?: (event: RelayConnectionEvent) => void | Promise<void>;
  requestTimeoutMs?: number;
}

export interface Relay {
  baseUrl: string;
  isConnected(agentId: string): boolean;
  handleHttp(req: IncomingMessage, res: ServerResponse): void;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sanitizeForwardHeaders(
  headers: IncomingMessage["headers"],
): Record<string, string | string[] | undefined> {
  const hopByHop = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ]);
  const result: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!hopByHop.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

function requestPathname(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
}

export function createRelay(options: RelayOptions): Relay {
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const connections = new Map<string, AgentConnection>();
  const wss = new WebSocketServer({ noServer: true });

  const relay: Relay = {
    baseUrl: "",
    isConnected(agentId: string): boolean {
      const conn = connections.get(agentId);
      return conn !== undefined && conn.ws.readyState === WebSocket.OPEN;
    },
    handleHttp(req, res) {
      void handleHttpRequest(req, res);
    },
    handleUpgrade(req, socket, head) {
      void handleUpgradeRequest(req, socket, head);
    },
    close() {
      for (const conn of connections.values()) {
        conn.ws.close();
      }
      connections.clear();
      wss.close();
    },
  };

  async function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const pathname = requestPathname(req);
    const match = pathname.match(/^\/agents\/([^/]+)(\/.*)?$/);
    if (!match?.[1]) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const agentId = match[1];
    const subPath = match[2] && match[2].length > 0 ? match[2] : "/";
    const conn = connections.get(agentId);

    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      req.resume();
      res.statusCode = 503;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Agent offline");
      return;
    }

    try {
      const body = await readRequestBody(req);
      const id = randomUUID();
      const tunnelReq: TunnelHttpRequest = {
        type: "http",
        id,
        method: req.method ?? "GET",
        path: subPath,
        headers: sanitizeForwardHeaders(req.headers),
        body: body.length > 0 ? body.toString("base64") : undefined,
      };

      const response = await new Promise<TunnelHttpResponse>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            conn.pending.delete(id);
            reject(new Error("リレー転送タイムアウト"));
          }, requestTimeoutMs);

          conn.pending.set(id, {
            resolve,
            reject,
            timer,
          });

          conn.ws.send(JSON.stringify(tunnelReq), (err) => {
            if (err) {
              clearTimeout(timer);
              conn.pending.delete(id);
              reject(err);
            }
          });
        },
      );

      res.statusCode = response.status;
      for (const [key, value] of Object.entries(response.headers)) {
        if (key.toLowerCase() !== "transfer-encoding") {
          res.setHeader(key, value);
        }
      }
      const responseBody = response.body
        ? Buffer.from(response.body, "base64")
        : Buffer.alloc(0);
      res.end(responseBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.statusCode = 502;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`Relay error: ${message}`);
    }
  }

  async function handleUpgradeRequest(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const parsed = new URL(req.url ?? "/", "http://127.0.0.1");
    if (parsed.pathname !== "/tunnel") {
      socket.destroy();
      return;
    }

    const agentId = parsed.searchParams.get("agentId");
    const token = parsed.searchParams.get("token");
    if (!agentId || !token || !(await options.authenticate(agentId, token))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const existing = connections.get(agentId);
      if (existing) {
        existing.ws.close();
        for (const pending of existing.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("接続が置き換えられました"));
        }
        existing.pending.clear();
      }

      const conn: AgentConnection = { ws, pending: new Map() };
      connections.set(agentId, conn);

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(String(data)) as TunnelHttpResponse;
          if (msg.type !== "http-response" || !msg.id) {
            return;
          }
          const pending = conn.pending.get(msg.id);
          if (!pending) {
            return;
          }
          clearTimeout(pending.timer);
          conn.pending.delete(msg.id);
          pending.resolve(msg);
        } catch {
          // ignore malformed tunnel messages
        }
      });

      ws.on("close", () => {
        if (connections.get(agentId)?.ws === ws) {
          connections.delete(agentId);
          void options.onDisconnect?.({ agentId });
        }
        for (const pending of conn.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("WebSocket 切断"));
        }
        conn.pending.clear();
      });

      ws.on("error", () => {
        ws.close();
      });

      void options.onConnect?.({ agentId });
    });
  }

  return relay;
}
