import { PERSONALITY_MAX_LENGTH } from "@comitia/shared";
import { GateViolation } from "./errors.js";

export function normalizePersonality(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if ([...trimmed].length > PERSONALITY_MAX_LENGTH) {
    throw new GateViolation(`性格は${PERSONALITY_MAX_LENGTH}字以内にしてください`);
  }
  return trimmed;
}
