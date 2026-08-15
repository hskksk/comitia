export interface EnginePlugin {
  start(session: {
    sessionId: string;
    workDir: string;
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
