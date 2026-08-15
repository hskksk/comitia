import { randomUUID } from "node:crypto";

/** 設計 02 §4 の tick 種別 */
export type TickType = "session.start" | "nudge" | "session.end_warning";

/** thin event: 種別・id・発行時刻のみ */
export interface Tick {
  id: string;
  type: TickType;
  issuedAt: string;
}

/** 新しい tick を生成する */
export function createTick(type: TickType): Tick {
  return {
    id: randomUUID(),
    type,
    issuedAt: new Date().toISOString(),
  };
}

/** メッセージ metadata から tick を復元する（アダプタ受信側） */
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
  if (
    type !== "session.start" &&
    type !== "nudge" &&
    type !== "session.end_warning"
  ) {
    return null;
  }
  return { id, type, issuedAt };
}
