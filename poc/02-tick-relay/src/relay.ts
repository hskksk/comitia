import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

/** PoC 用固定トークン */
export const POC_RELAY_TOKEN = "poc2-token";

/** HTTP-over-WebSocket 転送メッセージ */
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
  port?: number;
  token?: string;
  requestTimeoutMs?: number;
  onConnect?: (event: RelayConnectionEvent) => void;
  onDisconnect?: (event: RelayConnectionEvent) => void;
}

export interface Relay {
  readonly port: number;
  readonly baseUrl: string;
  isConnected(agentId: string): boolean;
  close(): Promise<void>;
}

/** リクエストボディを読み取る */
async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** 転送対象外のヘッダを除去する */
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

/** サービス側 HTTP + WS リレー（A2A を解釈しない純転送） */
export function createRelay(options: RelayOptions = {}): Promise<Relay> {
  const token = options.token ?? POC_RELAY_TOKEN;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const connections = new Map<string, AgentConnection>();

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const match = url.match(/^\/agents\/([^/]+)(\/.*)?$/);
    if (!match) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const agentId = match[1];
    const subPath = match[2] ?? "/";
    const conn = connections.get(agentId);

    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
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

      const response = await new Promise<TunnelHttpResponse>((resolve, reject) => {
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
      });

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
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const reqUrl = req.url ?? "";
    const parsed = new URL(reqUrl, "http://127.0.0.1");
    if (parsed.pathname !== "/tunnel") {
      socket.destroy();
      return;
    }

    const agentId = parsed.searchParams.get("agentId");
    const reqToken = parsed.searchParams.get("token");
    if (!agentId || reqToken !== token) {
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
          // 不正メッセージは無視
        }
      });

      ws.on("close", () => {
        if (connections.get(agentId)?.ws === ws) {
          connections.delete(agentId);
          options.onDisconnect?.({ agentId });
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

      options.onConnect?.({ agentId });
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(options.port ?? 0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("サーバーアドレスを取得できません"));
        return;
      }

      const relay: Relay = {
        port: addr.port,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        isConnected(agentId: string): boolean {
          const conn = connections.get(agentId);
          return conn !== undefined && conn.ws.readyState === WebSocket.OPEN;
        },
        close: async () => {
          for (const conn of connections.values()) {
            conn.ws.close();
          }
          connections.clear();
          wss.close();
          await new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
        },
      };

      resolve(relay);
    });
  });
}
