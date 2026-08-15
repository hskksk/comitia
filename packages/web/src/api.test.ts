import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardClient } from "./api.js";
import { setToken } from "./auth.js";

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
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

  it("throws on 401", async () => {
    setToken("bad");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    await expect(new BoardClient().me()).rejects.toThrow(/unauthorized/i);
  });
});
