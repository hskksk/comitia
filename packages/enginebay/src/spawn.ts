import { spawn, type ChildProcess } from "node:child_process";
import { processLineChunk } from "./lines.js";

export type SpawnedRun = {
  child: ChildProcess;
  stdout: AsyncIterable<string>;
  stderrText: () => string;
  wait: () => Promise<{ code: number; stderr: string }>;
  kill: (signal?: NodeJS.Signals) => Promise<void>;
};

export function spawnLineProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): SpawnedRun {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  let exitCode: number | undefined;
  const waiters: Array<() => void> = [];
  const lineQueue: string[] = [];
  let lineWait: (() => void) | undefined;
  let stdoutEnded = false;
  let stdoutBuffer = "";

  const endStdout = (): void => {
    if (stdoutEnded) {
      return;
    }
    if (stdoutBuffer.length > 0) {
      lineQueue.push(stdoutBuffer);
      stdoutBuffer = "";
    }
    stdoutEnded = true;
    lineWait?.();
  };

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  child.once("error", (error) => {
    stderr = `${stderr}\n${error.message}`.trim();
    exitCode = 1;
    endStdout();
    for (const wake of waiters.splice(0)) {
      wake();
    }
  });

  child.once("close", (code) => {
    exitCode = code ?? 1;
    for (const wake of waiters.splice(0)) {
      wake();
    }
  });

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer = processLineChunk(stdoutBuffer, chunk, (line) => {
        lineQueue.push(line);
        lineWait?.();
      });
    });
    child.stdout.on("end", () => {
      endStdout();
    });
  } else {
    stdoutEnded = true;
  }

  const stdout: AsyncIterable<string> = {
    [Symbol.asyncIterator](): AsyncIterator<string> {
      return {
        async next() {
          for (;;) {
            const line = lineQueue.shift();
            if (line !== undefined) {
              return { value: line, done: false };
            }
            if (stdoutEnded) {
              return { value: undefined, done: true };
            }
            await new Promise<void>((resolve) => {
              lineWait = resolve;
            });
          }
        },
      };
    },
  };

  async function wait(): Promise<{ code: number; stderr: string }> {
    if (exitCode !== undefined) {
      return { code: exitCode, stderr };
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
    return { code: exitCode ?? 1, stderr };
  }

  async function kill(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
      child.kill(signal);
    });
  }

  return {
    child,
    stdout,
    stderrText: () => stderr,
    wait,
    kill,
  };
}
