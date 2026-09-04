import { clearToken, getToken } from "./auth.js";

export const UNAUTHORIZED_EVENT = "comitia:unauthorized";
const PROJECT_ID_HEADER = "x-comitia-project-id";

export type ProjectListItem = {
  id: string;
  name: string;
  repoUrl: string | null;
  ownerParticipantId: string;
};

export type MeResponse = {
  participant: {
    id: string;
    kind: "human" | "agent";
    displayName: string;
    engine?: string | null;
    personality?: string | null;
    githubLogin?: string | null;
    githubUserId?: string | null;
  };
  projectId: string | null;
  projects?: ProjectListItem[];
  label?: string;
  owner?: { id: string; displayName: string } | null;
  project?: { id: string; name: string; repoUrl: string | null } | null;
  roles?: string[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  repoUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  githubInstallationId: string | null;
  ownerParticipantId: string;
  threadCounts: {
    discussing: number;
    awaiting_decision: number;
    decided: number;
    rejected: number;
    completed: number;
  };
  queueCount: number;
  inboxCount: number;
  queuePreview: Array<{
    threadId: string;
    title: string;
    consensusType: string | null;
    enteredAt: string;
  }>;
  participantStats?: {
    humans: number;
    agentsConnected: number;
    agentsDisconnected: number;
  };
  setup: {
    projectRule: boolean;
    threadTemplate: boolean;
  };
  activeProjectRule: {
    threadId: string;
    summary: string;
    content: string;
  } | null;
};

export type EventItem = {
  id: string;
  kind: string;
  threadId: string | null;
  actorParticipantId: string | null;
  actorDisplayName: string | null;
  targetDisplayName: string | null;
  payload: unknown;
  createdAt: string;
};

export type OwnedAgent = {
  id: string;
  displayName: string;
  engine: string;
  personality: string | null;
  ownerParticipantId: string;
};

export type IdentityCredential = {
  id: string;
  clientLabel: string;
  createdAt: string;
  current: boolean;
};

export type QueueItem = {
  threadId: string;
  title: string;
  type: string;
  state: string;
  consensusType: string | null;
  humanRequired: boolean;
  enteredAt: string;
  synthesis: { id: string; body: string; createdAt: string } | null;
  candidateProposal: {
    id: string;
    versionNumber: number;
    content: string;
  } | null;
  activeWorkClaimants: string[];
};

export type InboxItem = {
  threadId: string;
  title: string;
  type: string;
  kind: "merge_wait" | "post_review";
  decidedAt: string;
  latestReport: { id: string; body: string; createdAt: string } | null;
  pullRequests: Array<{
    number: number;
    url: string;
    title: string;
    state: "open" | "merged" | "closed";
  }>;
};

export type ThreadListItem = {
  id: string;
  title: string;
  type: string;
  state: string;
  consensusType: string | null;
  ownerParticipantId: string;
  createdAt: string;
  activeWorkClaimants: string[];
};

export type HumanProposal = {
  id: string;
  number: number;
  latestVersionId: string;
  versionNumber: number;
  content: string;
};

export type ThreadWorkClaim = {
  id: string;
  participantId: string;
  displayName: string;
  paths: string[];
  createdAt: string;
};

export type MemoryItem = {
  id: string;
  participantId: string;
  body: string;
  createdAt: string;
  supersededAt: string | null;
};

export type NoteItem = {
  id: string;
  authorParticipantId: string;
  projectId: string;
  title: string;
  body: string;
  format: "file" | "journal";
  visibility: "public" | "private";
  createdAt: string;
  updatedAt: string;
};

export type NoteCommentItem = {
  id: string;
  noteId: string;
  authorParticipantId: string;
  body: string;
  createdAt: string;
};

export type HumanThreadView = {
  thread: {
    id: string;
    title: string;
    type: string;
    state: string;
    consensusType: string | null;
    humanRequired: boolean;
    ownerParticipantId: string;
    projectId: string;
    awaitingEnteredAt: string | null;
    timingEndsAt: string | null;
    target?: string | null;
    sharedArtifactKind?: string | null;
  };
  consensusReasons: string[];
  synthesis: { id: string; body: string; createdAt: string } | null;
  candidateProposal: {
    id: string;
    versionNumber: number;
    content: string;
  } | null;
  proposals: HumanProposal[];
  posts: Array<{
    id: string;
    type: string;
    body: string;
    rationale: string | null;
    authorParticipantId: string;
    authorDisplayName: string;
    createdAt: string;
  }>;
  pullRequests: Array<{
    number: number;
    url: string;
    title: string;
    state: "open" | "merged" | "closed";
  }>;
  workClaims: ThreadWorkClaim[];
  decisionView: {
    diff: string | null;
    previousAgreement: { id: string; summaryDiff: string } | null;
    activitySpent: number;
  } | null;
};

export type SearchThreadItem = {
  id: string;
  title: string;
  type: string;
  state: string;
};

export type AgreementItem = {
  id: string;
  threadId: string;
  threadTitle: string | null;
  proposalContent: string;
  summary: string;
  outcome: string;
  binding: boolean;
  state: string;
  createdAt: string;
};

export type ParticipantItem = {
  id: string;
  kind: "human" | "agent";
  displayName: string;
  label?: string;
  engine: string | null;
  personality?: string | null;
  ownerParticipantId: string | null;
  roles: string[];
  connection: {
    status: "connected" | "disconnected" | "never";
    lastSeenAt: string | null;
  } | null;
  openSession: {
    id: string;
    remainingBudget: number;
    firstGoal: string | null;
    startedAt: string;
  } | null;
  wake: "undigested" | "queued" | "idle" | null;
};

export type SessionItem = {
  id: string;
  participantId: string;
  displayName: string;
  startedAt: string;
  endedAt: string | null;
  endedReason: string | null;
  remainingBudget: number;
  budgetLimit: number;
  budgetUsed: number;
  goals: Array<{ id: string; text: string; status: string }>;
};

export type ChatLogResponse = {
  sessionId: string;
  participantId: string;
  startedAt: string;
  endedAt: string | null;
  chatLog: string;
  truncated: boolean;
};

export type SessionTraceResponse = {
  sessionId: string;
  entries: import("@comitia/shared").TraceEvent[];
  hasMore: boolean;
};

export type CreateThreadInput = {
  title: string;
  type: string;
  trigger: string;
  duplicateSearchQuery: string;
  consensusType?: string;
  target?: string;
  sharedArtifactKind?: string;
  conflictCitationsChecked?: boolean;
  engineDiversity?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let currentProjectId: string | null = null;

export function setCurrentProjectId(projectId: string | null): void {
  currentProjectId = projectId;
}

export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

function needsProjectHeader(path: string): boolean {
  if (!path.startsWith("/v1/")) {
    return false;
  }
  if (path === "/v1/me" || path.startsWith("/v1/me/")) {
    return false;
  }
  if (path === "/v1/projects" || path === "/v1/join" || path === "/v1/init") {
    return false;
  }
  if (path.startsWith("/v1/system/")) {
    return false;
  }
  if (path.startsWith("/v1/auth")) {
    return false;
  }
  return true;
}

export class BoardClient {
  async authConfig(): Promise<{ githubOAuth: boolean }> {
    return this.request("/v1/auth/config");
  }

  async me(): Promise<MeResponse> {
    return this.request("/v1/me");
  }

  async patchMe(input: { displayName: string }): Promise<{
    participant: { id: string; kind: "human"; displayName: string };
  }> {
    return this.request("/v1/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async listProjects(): Promise<{ items: ProjectListItem[] }> {
    return this.request("/v1/projects");
  }

  async createProject(input: {
    name: string;
    repoUrl?: string;
    projectRule?: { templateId?: string; content?: string };
    threadTemplate?: { templateId?: string; content?: string };
  }): Promise<ProjectListItem> {
    return this.request("/v1/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async listSystemTemplates(kind?: "project_rule" | "thread_template"): Promise<{
    items: Array<{
      id: string;
      kind: "project_rule" | "thread_template";
      title: string;
      summary: string;
      content: string;
    }>;
  }> {
    const query = kind ? `?kind=${kind}` : "";
    return this.request(`/v1/system/templates${query}`);
  }

  async getProject(id: string): Promise<ProjectSummary> {
    return this.request(`/v1/projects/${id}`);
  }

  async patchProject(
    id: string,
    input: { name?: string; repoUrl?: string | null },
  ): Promise<{
    id: string;
    name: string;
    repoUrl: string | null;
    githubOwner: string | null;
    githubRepo: string | null;
  }> {
    return this.request(`/v1/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async createInvite(
    projectId: string,
  ): Promise<{ token: string; projectId: string }> {
    return this.request(`/v1/projects/${projectId}/invites`, {
      method: "POST",
      body: "{}",
    });
  }

  async join(token: string): Promise<{
    id: string;
    name: string;
    ownerParticipantId: string;
  }> {
    return this.request("/v1/join", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  async listMembers(projectId: string): Promise<{ items: ParticipantItem[] }> {
    return this.request(`/v1/projects/${projectId}/members`);
  }

  async removeMember(projectId: string, participantId: string): Promise<void> {
    await this.request(`/v1/projects/${projectId}/members/${participantId}`, {
      method: "DELETE",
    });
  }

  async listOwnedAgents(): Promise<{ items: OwnedAgent[] }> {
    return this.request("/v1/me/agents");
  }

  async listIdentityCredentials(): Promise<{ items: IdentityCredential[] }> {
    return this.request("/v1/me/credentials");
  }

  async revokeIdentityCredential(
    credentialId: string,
  ): Promise<{ revoked: boolean; revokedCredentialId: string; current: boolean }> {
    return this.request(`/v1/me/credentials/${credentialId}`, {
      method: "DELETE",
    });
  }

  async createAgent(input: {
    displayName: string;
    engine: string;
    projectId: string;
    role?: string;
    personality?: string;
  }): Promise<{ agentId: string; projectId: string; agentToken: string }> {
    return this.request("/v1/agents", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateOwnedAgent(
    agentId: string,
    input: { displayName?: string; engine?: string; personality?: string | null },
  ): Promise<{
    id: string;
    displayName: string;
    engine: string;
    personality: string | null;
  }> {
    return this.request(`/v1/me/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async archiveOwnedAgent(agentId: string): Promise<void> {
    await this.request(`/v1/me/agents/${agentId}`, { method: "DELETE" });
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.request(`/v1/threads/${threadId}`, { method: "DELETE" });
  }

  async archiveProposal(threadId: string, proposalId: string): Promise<void> {
    await this.request(`/v1/threads/${threadId}/proposals/${proposalId}`, {
      method: "DELETE",
    });
  }

  async events(limit = 10): Promise<{ items: EventItem[] }> {
    const params = new URLSearchParams({ limit: String(limit) });
    return this.request(`/v1/events?${params.toString()}`);
  }

  async queue(): Promise<{ items: QueueItem[] }> {
    return this.request("/v1/queue");
  }

  async inbox(): Promise<{ items: InboxItem[] }> {
    return this.request("/v1/inbox");
  }

  async threads(): Promise<{ items: ThreadListItem[] }> {
    return this.request("/v1/threads");
  }

  async thread(id: string): Promise<HumanThreadView> {
    return this.request(`/v1/threads/${id}`);
  }

  async createThread(
    input: CreateThreadInput,
  ): Promise<{ id: string; state: string }> {
    return this.request("/v1/threads", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async searchThreads(q: string): Promise<{ items: SearchThreadItem[] }> {
    const params = new URLSearchParams({ q });
    return this.request(`/v1/search/threads?${params.toString()}`);
  }

  async searchDecisions(q: string): Promise<{ items: AgreementItem[] }> {
    const params = new URLSearchParams({ q });
    return this.request(`/v1/search/decisions?${params.toString()}`);
  }

  async addPost(
    threadId: string,
    input: {
      type: string;
      body: string;
      rationale?: string;
      blocking?: boolean;
      proposalVersionId?: string;
    },
  ): Promise<{ id: string }> {
    return this.request(`/v1/threads/${threadId}/posts`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async addProposal(
    threadId: string,
    content: string,
  ): Promise<HumanProposal> {
    return this.request(`/v1/threads/${threadId}/proposals`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  async declare(
    threadId: string,
    payload: Record<string, unknown>,
  ): Promise<{ thread: { state: string } }> {
    return this.request(`/v1/threads/${threadId}/declare`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async claimWork(
    threadId: string,
    paths: string[],
  ): Promise<{ id: string; threadId: string; paths: string[]; overlaps: unknown[] }> {
    return this.request(`/v1/threads/${threadId}/work-claims`, {
      method: "POST",
      body: JSON.stringify({ paths }),
    });
  }

  async releaseWork(
    threadId: string,
    claimId: string,
  ): Promise<{ id: string; active: boolean }> {
    return this.request(`/v1/threads/${threadId}/work-claims/${claimId}/release`, {
      method: "POST",
      body: "{}",
    });
  }

  async memory(): Promise<{ items: MemoryItem[] }> {
    return this.request("/v1/memory");
  }

  async notes(q?: string): Promise<{ items: NoteItem[] }> {
    const params = q ? `?${new URLSearchParams({ q }).toString()}` : "";
    return this.request(`/v1/notes${params}`);
  }

  async writeNote(input: {
    noteId?: string;
    title: string;
    body: string;
    format: "file" | "journal";
    visibility?: "public" | "private";
  }): Promise<NoteItem> {
    return this.request("/v1/notes", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async note(id: string): Promise<NoteItem> {
    return this.request(`/v1/notes/${id}`);
  }

  async commentNote(id: string, body: string): Promise<NoteCommentItem> {
    return this.request(`/v1/notes/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async participants(): Promise<{ items: ParticipantItem[] }> {
    return this.request("/v1/participants");
  }

  async agreements(state?: string): Promise<{ items: AgreementItem[] }> {
    const params = state ? `?state=${encodeURIComponent(state)}` : "";
    return this.request(`/v1/agreements${params}`);
  }

  async agentSessions(agentId: string): Promise<{ items: SessionItem[] }> {
    return this.request(`/v1/agents/${agentId}/sessions`);
  }

  async chatLog(
    sessionId: string,
    options: { tailChars?: number; fromStart?: boolean } = {},
  ): Promise<ChatLogResponse> {
    const params = new URLSearchParams();
    if (options.fromStart) {
      params.set("fromStart", "1");
    } else if (options.tailChars) {
      params.set("tailChars", String(options.tailChars));
    }
    const query = params.toString();
    return this.request(
      `/v1/sessions/${sessionId}/chat-log${query ? `?${query}` : ""}`,
    );
  }

  async sessionTrace(
    sessionId: string,
    options: { afterSeq?: number; limit?: number } = {},
  ): Promise<SessionTraceResponse> {
    const params = new URLSearchParams();
    if (options.afterSeq !== undefined) {
      params.set("afterSeq", String(options.afterSeq));
    }
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    return this.request(
      `/v1/sessions/${sessionId}/trace${query ? `?${query}` : ""}`,
    );
  }

  async wakeAgent(
    agentId: string,
  ): Promise<{ sessionId?: string; tickId: string; status: string }> {
    return this.request(`/v1/agents/${agentId}/request-session`, {
      method: "POST",
      body: "{}",
    });
  }

  async connectGitHubApp(input: { repoUrl?: string } = {}): Promise<
    { connected: true } | { connected: false; url: string }
  > {
    return this.request("/v1/github/connect", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    const headers = new Headers(init.headers);
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (currentProjectId && needsProjectHeader(path)) {
      headers.set(PROJECT_ID_HEADER, currentProjectId);
    }
    const res = await fetch(path, {
      ...init,
      headers: Object.fromEntries(headers),
    });
    if (res.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      throw new ApiError(401, "unauthorized");
    }
    if (res.status === 204) {
      return undefined as T;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, body.error ?? `request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }
}

export const boardClient = new BoardClient();
