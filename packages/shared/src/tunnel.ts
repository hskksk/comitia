export interface TunnelHttpRequest {
  type: "http";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string;
}

export interface TunnelHttpResponse {
  type: "http-response";
  id: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
}

export type TunnelControl =
  | { type: "ping" }
  | { type: "pong" };
