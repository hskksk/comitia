import type { ParticipantKind } from "./constants.js";

/** Affiliation separator: agentName@registererName */
export const AGENT_LABEL_SEPARATOR = "@";

export function formatParticipantLabel(input: {
  kind: ParticipantKind;
  displayName: string;
  ownerDisplayName?: string | null;
}): string {
  if (input.kind !== "agent" || !input.ownerDisplayName) {
    return input.displayName;
  }
  return `${input.displayName}${AGENT_LABEL_SEPARATOR}${input.ownerDisplayName}`;
}

export function agentNameContainsSeparator(name: string): boolean {
  return name.includes(AGENT_LABEL_SEPARATOR);
}

/** Human REST selects the current project with this header. */
export const PROJECT_ID_HEADER = "x-comitia-project-id";
