import type { MeResponse, ProjectSummary } from "./api.js";

export const LAST_PROJECT_KEY = "comitia:lastProjectId";

export function saveLastProjectId(id: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // ignore storage errors in tests / private mode
  }
}

export function getLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function resolvePostLoginPath(me: MeResponse): string {
  if (me.participant.kind === "agent") {
    return me.projectId ? `/p/${me.projectId}` : "/projects";
  }
  const projects = me.projects ?? [];
  if (projects.length === 0) {
    return "/projects";
  }
  if (projects.length === 1) {
    return `/p/${projects[0]!.id}`;
  }
  const last = getLastProjectId();
  if (last && projects.some((project) => project.id === last)) {
    return `/p/${last}`;
  }
  return "/projects";
}

export function pickProjectId(me: MeResponse): string | null {
  if (me.participant.kind === "agent") {
    return me.projectId;
  }
  const projects = me.projects ?? [];
  if (projects.length === 0) {
    return null;
  }
  const last = getLastProjectId();
  if (last && projects.some((project) => project.id === last)) {
    return last;
  }
  if (me.projectId && projects.some((project) => project.id === me.projectId)) {
    return me.projectId;
  }
  return projects[0]!.id;
}

export function projectPath(projectId: string, suffix = ""): string {
  const normalized = suffix.startsWith("/") ? suffix : suffix ? `/${suffix}` : "";
  return `/p/${projectId}${normalized}`;
}

export function isProjectOwner(
  me: MeResponse,
  project: Pick<ProjectSummary, "ownerParticipantId">,
): boolean {
  return me.participant.id === project.ownerParticipantId;
}
