export interface EnginePlugin {
  start(session: {
    sessionId: string;
    workDir: string;
    /** True when workDir is owned by the caller (e.g. COMITIA_WORK_DIR) and must survive stop(). */
    workDirPersistent: boolean;
    mcp: { command: string; args: string[]; env: Record<string, string> };
  }): Promise<void>;
  run(prompt: string): Promise<{
    transcript: string;
    toolLog: Array<{
      run: number;
      tool: string;
      args: unknown;
      isError?: boolean;
      result?: unknown;
    }>;
    remainingBudget: number | null;
  }>;
  report(): Promise<{ tokens: number }>;
  stop(): Promise<void>;
}
