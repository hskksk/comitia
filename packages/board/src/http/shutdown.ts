export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type ShutdownProcess = {
  once: (event: string, listener: () => void) => void;
  removeListener: (event: string, listener: () => void) => void;
  exit: (code: number) => void;
};

export function installShutdownHandlers(
  shutdown: () => Promise<void>,
  proc: ShutdownProcess = process,
  signals: readonly string[] = SHUTDOWN_SIGNALS,
): () => void {
  let shuttingDown = false;
  const handler = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void shutdown().then(
      () => proc.exit(0),
      (error: unknown) => {
        console.error("comitia board shutdown error:", error);
        proc.exit(1);
      },
    );
  };
  for (const signal of signals) {
    proc.once(signal, handler);
  }
  return () => {
    for (const signal of signals) {
      proc.removeListener(signal, handler);
    }
  };
}
