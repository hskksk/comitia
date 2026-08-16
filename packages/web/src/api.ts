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

  async declare(
    threadId: string,
    payload: Record<string, unknown>,
  ): Promise<{ thread: { state: string } }> {
    return this.request(`/v1/threads/${threadId}/declare`, {
      method: "POST",
      body: JSON.stringify(payload),
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
