import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  postAuthorizedWithRetry,
  UPLOAD_RETRY_BASE_MS,
} from "./board-upload.js";

describe("postAuthorizedWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a 503 and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = postAuthorizedWithRetry("http://board", "tok", "/v1/x", {});
    await vi.advanceTimersByTimeAsync(UPLOAD_RETRY_BASE_MS);
    const response = await pending;

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      postAuthorizedWithRetry("http://board", "tok", "/v1/x", {}),
    ).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network errors then throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);

    const pending = postAuthorizedWithRetry(
      "http://board",
      "tok",
      "/v1/x",
      {},
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(UPLOAD_RETRY_BASE_MS);
    await vi.advanceTimersByTimeAsync(UPLOAD_RETRY_BASE_MS * 2);
    const error = await pending;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("socket hang up");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
