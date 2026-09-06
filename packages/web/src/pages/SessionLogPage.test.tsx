import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import { SessionLogPage } from "./SessionLogPage.js";

const sessionTraceMock = vi.fn();
const chatLogMock = vi.fn();

vi.mock("../api.js", () => ({
  boardClient: {
    sessionTrace: (...args: unknown[]) => sessionTraceMock(...args),
    chatLog: (...args: unknown[]) => chatLogMock(...args),
  },
}));

function renderLogPage() {
  return render(
    <MemoryRouter initialEntries={["/p/proj/sessions/sess-1"]}>
      <Routes>
        <Route path="/p/:projectId/sessions/:id" element={<SessionLogPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SessionLogPage", () => {
  afterEach(() => {
    cleanup();
    sessionTraceMock.mockReset();
    chatLogMock.mockReset();
  });

  it("shows pretty-printed tool args and result bodies", async () => {
    sessionTraceMock.mockResolvedValue({
      sessionId: "sess-1",
      hasMore: false,
      entries: [
        {
          v: TRACE_VERSION,
          seq: 1,
          at: "2026-08-31T11:23:06.501Z",
          kind: "tool_call",
          run: 2,
          tool: "read_thread",
          args: { threadId: "thread-abc" },
        },
        {
          v: TRACE_VERSION,
          seq: 2,
          at: "2026-08-31T11:23:07.220Z",
          kind: "tool_result",
          run: 2,
          tool: "read_thread",
          ok: true,
          remainingBudget: 800,
          result: [{ type: "text", text: '{"posts":[{"body":"hello"}]}' }],
        },
      ],
    });
    chatLogMock.mockResolvedValue({
      sessionId: "sess-1",
      participantId: "agent-1",
      startedAt: "2026-08-31T11:00:00.000Z",
      endedAt: null,
      chatLog: "",
      truncated: false,
    });

    renderLogPage();

    expect(await screen.findByText("ツール")).toBeInTheDocument();
    expect(screen.getAllByText("read_thread")).toHaveLength(2);
    expect(screen.getByText(/threadId: thread-abc/)).toBeInTheDocument();
    expect(screen.getByText("ok · 残量 800")).toBeInTheDocument();
    expect(screen.getByText(/body: hello/)).toBeInTheDocument();
    expect(screen.queryByText("@json")).not.toBeInTheDocument();
  });

  it("reconstructs raw text from traces when chat_log is empty", async () => {
    sessionTraceMock.mockResolvedValue({
      sessionId: "sess-1",
      hasMore: false,
      entries: [
        {
          v: TRACE_VERSION,
          seq: 1,
          at: "2026-08-31T11:23:06.501Z",
          kind: "text",
          run: 1,
          text: "hello from trace",
        },
      ],
    });
    chatLogMock.mockResolvedValue({
      sessionId: "sess-1",
      participantId: "agent-1",
      startedAt: "2026-08-31T11:00:00.000Z",
      endedAt: "2026-08-31T11:10:00.000Z",
      chatLog: "",
      truncated: false,
    });

    renderLogPage();

    expect(await screen.findByText("hello from trace")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "生テキスト" }));
    expect(screen.getByText(/@json /)).toBeInTheDocument();
    expect(screen.getByText(/hello from trace/)).toBeInTheDocument();
    expect(screen.queryByText("(空)")).not.toBeInTheDocument();
  });

  it("still shows chat_log when structured trace fetch fails", async () => {
    sessionTraceMock.mockRejectedValue(new Error("trace unavailable"));
    chatLogMock.mockResolvedValue({
      sessionId: "sess-1",
      participantId: "agent-1",
      startedAt: "2026-08-31T11:00:00.000Z",
      endedAt: "2026-08-31T11:10:00.000Z",
      chatLog: "legacy log line\n",
      truncated: false,
    });

    renderLogPage();

    expect(await screen.findByText(/legacy log line/)).toBeInTheDocument();
    expect(screen.getByText("trace unavailable")).toBeInTheDocument();
    expect(screen.queryByText("(空)")).not.toBeInTheDocument();
  });
});
