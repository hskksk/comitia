export type EngineGithubAuth = {
  token: string;
  expiresAt: string;
  committerName: string;
};

export interface EnginePlugin {
  start(session: {
    sessionId: string;
    workDir: string;
    /** True when workDir is owned by the caller (e.g. COMITIA_WORK_DIR) and must survive stop(). */
    workDirPersistent: boolean;
    mcp: { command: string; args: string[]; env: Record<string, string> };
    environmentPrompt?: string;
    github?: EngineGithubAuth | null;
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
  /** End the current session; runtime dirs may survive until dispose(). */
  stop(): Promise<void>;
  /** Tear down connect-scoped runtime state (e.g. isolated Claude HOME). */
  dispose(): Promise<void>;
  updateGithubAuth?(auth: EngineGithubAuth | null): Promise<void>;
}
