import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installShutdownHandlers, SHUTDOWN_SIGNALS } from "./shutdown.js";

function mockProcess() {
  const emitter = new EventEmitter();
  const proc = {
    once: (event: string, listener: () => void) => {
      emitter.once(event, listener);
    },
    removeListener: (event: string, listener: () => void) => {
      emitter.removeListener(event, listener);
    },
    exit: vi.fn(),
    emit: (event: string) => emitter.emit(event),
  };
  return proc;
}

describe("installShutdownHandlers", () => {
  it("listens for SIGINT and SIGTERM", () => {
    expect([...SHUTDOWN_SIGNALS]).toEqual(["SIGINT", "SIGTERM"]);
  });

  it("runs shutdown once then exits 0", async () => {
    const proc = mockProcess();
    const shutdown = vi.fn(async () => {});
    installShutdownHandlers(shutdown, proc);

    proc.emit("SIGTERM");
    proc.emit("SIGTERM");
    proc.emit("SIGINT");

    await vi.waitFor(() => {
      expect(proc.exit).toHaveBeenCalledWith(0);
    });
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("exits 1 when shutdown fails", async () => {
    const proc = mockProcess();
    const shutdown = vi.fn(async () => {
      throw new Error("close failed");
    });
    installShutdownHandlers(shutdown, proc);

    proc.emit("SIGINT");

    await vi.waitFor(() => {
      expect(proc.exit).toHaveBeenCalledWith(1);
    });
  });
});
