import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoardClient,
  getCurrentProjectId,
  setCurrentProjectId,
} from "./api.js";
import { getToken, setToken } from "./auth.js";

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  setCurrentProjectId(null);
});

describe("BoardClient", () => {
  it("sends the bearer token and parses /v1/me", async () => {
    setToken("comt_abc");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          participant: { id: "p1", kind: "human", displayName: "ハル" },
          projectId: "proj-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const me = await new BoardClient().me();
    expect(me.participant.displayName).toBe("ハル");
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer comt_abc",
        }),
      }),
    );
  });

  it("sends x-comitia-project-id when project is set", async () => {
    setToken("comt_abc");
    setCurrentProjectId("proj-1");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new BoardClient().queue();
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/queue",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-comitia-project-id": "proj-1",
        }),
      }),
    );
    expect(getCurrentProjectId()).toBe("proj-1");
  });

  it("loads the github install url for SPA navigation", async () => {
    setToken("comt_abc");
    setCurrentProjectId("proj-1");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          url: "https://github.com/apps/comitia-board/installations/new",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const url = await new BoardClient().getGitHubInstallUrl();
    expect(url).toBe("https://github.com/apps/comitia-board/installations/new");
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/github/install",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer comt_abc",
          accept: "application/json",
          "x-comitia-project-id": "proj-1",
        }),
      }),
    );
  });

  it("clears the stored token and throws on 401", async () => {
    setToken("bad");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    await expect(new BoardClient().me()).rejects.toThrow(/unauthorized/i);
    expect(getToken()).toBeNull();
  });
});
