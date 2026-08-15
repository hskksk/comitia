import {
  type TunnelControl,
  type TunnelHttpRequest,
  type TunnelHttpResponse,
} from "@comitia/shared";
import WebSocket from "ws";

export interface ConnectTunnelOptions {
  relayWsUrl: string;
  localBaseUrl: string;
}

export interface TunnelConnection {
  disconnect: () => void;
  isConnected: () => boolean;
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

async function handleTunnelRequest(
  ws: WebSocket,
  localBaseUrl: string,
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

function attachTunnelHandlers(ws: WebSocket, localBaseUrl: string): void {
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
      void handleTunnelRequest(ws, localBaseUrl, msg);
    } catch {
      // ignore malformed tunnel messages
    }
  });
}

export async function connectTunnel(
  options: ConnectTunnelOptions,
): Promise<TunnelConnection> {
  const ws = new WebSocket(options.relayWsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => {
      attachTunnelHandlers(ws, options.localBaseUrl);
      resolve();
    });
    ws.once("error", reject);
  });

  return {
    disconnect(): void {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    },
    isConnected(): boolean {
      return ws.readyState === WebSocket.OPEN;
    },
  };
}
