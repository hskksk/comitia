export const TICK_TYPES = [
  "session.start",
  "nudge",
  "session.end_warning",
] as const;
export type TickType = (typeof TICK_TYPES)[number];

export interface Tick {
  id: string;
  type: TickType;
  issuedAt: string;
  sessionId?: string;
}

export function createTick(
  type: TickType,
  options: { sessionId?: string } = {},
): Tick {
  return {
    // Web Crypto (Node 19+ and browsers) — avoid node:crypto so Vite can bundle shared.
    id: crypto.randomUUID(),
    type,
    issuedAt: new Date().toISOString(),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  };
}

export function parseTickFromMetadata(
  metadata: Record<string, unknown> | undefined,
): Tick | null {
  if (!metadata) {
    return null;
  }
  const id = metadata.tickId;
  const type = metadata.tickType;
  const issuedAt = metadata.issuedAt;
  if (
    typeof id !== "string" ||
    typeof type !== "string" ||
    typeof issuedAt !== "string"
  ) {
    return null;
  }
  if (!TICK_TYPES.includes(type as TickType)) {
    return null;
  }
  const sessionId = metadata.sessionId;
  return {
    id,
    type: type as TickType,
    issuedAt,
    ...(typeof sessionId === "string" ? { sessionId } : {}),
  };
}
