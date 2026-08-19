import { clearToken, getToken } from "./auth.js";

export const UNAUTHORIZED_EVENT = "comitia:unauthorized";

export type MeResponse = {
  participant: { id: string; kind: "human" | "agent"; displayName: string };
  projectId: string;
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
  };
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
  engine: string | null;
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

export type CreateThreadInput = {
  title: string;
  type: string;
  trigger: string;
  duplicateSearchQuery: string;
  consensusType?: string;
  target?: string;
  sharedArtifactKind?: string;
  conflictCitationsChecked?: boolean;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class BoardClient {
  async authConfig(): Promise<{ githubOAuth: boolean }> {
    return this.request("/v1/auth/config");
  }

  async me(): Promise<MeResponse> {
    return this.request("/v1/me");
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

  async wakeAgent(
    agentId: string,
  ): Promise<{ sessionId?: string; tickId: string; status: string }> {
    return this.request(`/v1/agents/${agentId}/request-session`, {
      method: "POST",
      body: "{}",
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
    const res = await fetch(path, {
      ...init,
      headers: Object.fromEntries(headers),
    });
    if (res.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      throw new ApiError(401, "unauthorized");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, body.error ?? `request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }
}

export const boardClient = new BoardClient();
