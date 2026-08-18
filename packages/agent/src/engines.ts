import { ENGINES, isSupportedEngine } from "@comitia/shared";

export { ENGINES, isSupportedEngine };

export function assertSupportedEngine(engine: string): void {
  if (!isSupportedEngine(engine)) {
    throw new Error(
      `Unsupported engine: ${engine}（利用できるのは ${ENGINES.join(", ")}）`,
    );
  }
}
