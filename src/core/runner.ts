// Runs a program with an argument array and a time limit. This is the only place the plugin starts a process.
//
// Security (see docs/disclosures.md): the program is started directly, never through a shell (`shell: false`), so no
// argument is ever parsed as shell syntax; the arguments are an array, never a command line built from text; the
// program path comes from detection or a per-device setting, never from the vault's data.json; output is capped and
// every call has a timeout, after which the process is killed. No window or terminal is ever opened.

import type { ExecFileException } from "child_process";

/** Output from a spawned process's stream. */
interface Readable {
  on(event: "data", f: (chunk: unknown) => void): unknown;
}

/** The part of a spawned process the runner uses. */
export interface Spawned {
  stdin: { write(s: string): unknown; end(): unknown; on(event: "error", f: (e: Error) => void): unknown } | null;
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "close", f: (code: number | null, signal: string | null) => void): unknown;
  on(event: "error", f: (e: Error) => void): unknown;
  kill(): unknown;
}

/** The part of Node's `child_process` the runner needs (injected, so the plugin loads on mobile and tests can run). */
export interface ChildProcessApi {
  execFile(
    file: string,
    args: readonly string[],
    options: {
      shell: false;
      windowsHide: boolean;
      timeout: number;
      maxBuffer: number;
      encoding: "utf8";
      env?: Record<string, string | undefined>;
    },
    callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
  ): unknown;
  spawn(
    file: string,
    args: readonly string[],
    options: { shell: false; windowsHide: true; stdio: ["pipe", "pipe", "pipe"]; env?: Record<string, string | undefined> },
  ): Spawned;
}

export interface RunResult {
  /** The exit code; -1 when the process did not run or was killed. */
  code: number;
  stdout: string;
  stderr: string;
  /** The time limit was reached and the process was killed. */
  timedOut: boolean;
  /** The process could not be started (e.g. ENOENT): the system's error code. */
  spawnError?: string;
  /** How long the call took, in milliseconds. */
  ms: number;
  /** The caller stopped the process (interactive runs). */
  cancelled?: boolean;
}

/** What an interactive run's output handler can do: answer on the program's input, or stop it. */
export interface RunIo {
  reply(line: string): void;
  cancel(): void;
}

export interface Runner {
  run(args: readonly string[], timeoutMs: number): Promise<RunResult>;
  /** Runs with the program's input kept open; `onOutput` sees the output so far and may answer a question. */
  runInteractive?(args: readonly string[], timeoutMs: number, onOutput: (stdoutSoFar: string, io: RunIo) => void): Promise<RunResult>;
  /** What is run, for the log (the program's path). */
  readonly program: string;
}

/** Output beyond this is cut (MEGAcmd's answers here are a few KB). */
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * The environment for MEGAcmd's client, without MEGACMD_DO_NOT_REDACT_LINES: that variable would make MEGAcmd's server,
 * when this call starts it, write sign-in commands to its log unredacted.
 */
export function safeEnv(env: Record<string, string | undefined> | undefined): Record<string, string | undefined> | undefined {
  if (!env) return undefined;
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() !== "MEGACMD_DO_NOT_REDACT_LINES") out[k] = v;
  return out;
}

export class ProcessRunner implements Runner {
  readonly program: string;
  private readonly cp: ChildProcessApi;
  private readonly prefix: readonly string[];
  private readonly env: Record<string, string | undefined> | undefined;

  /**
   * @param cp Node's child_process (or a stand-in).
   * @param program The program's absolute path.
   * @param prefix Arguments put before every call's own (the tests run a script with Node this way).
   * @param env The environment (MEGACMD_DO_NOT_REDACT_LINES taken out); Node's own when undefined.
   */
  constructor(cp: ChildProcessApi, program: string, prefix: readonly string[] = [], env?: Record<string, string | undefined>) {
    this.cp = cp;
    this.program = program;
    this.prefix = prefix;
    this.env = safeEnv(env);
  }

  run(args: readonly string[], timeoutMs: number): Promise<RunResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      try {
        this.cp.execFile(
          this.program,
          [...this.prefix, ...args],
          { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8", env: this.env },
          (error, stdout, stderr) => {
            const ms = Date.now() - started;
            const out = typeof stdout === "string" ? stdout : "";
            const err = typeof stderr === "string" ? stderr : "";
            if (!error) return resolve({ code: 0, stdout: out, stderr: err, timedOut: false, ms });
            if (typeof error.code === "number") return resolve({ code: error.code, stdout: out, stderr: err, timedOut: false, ms });
            if (error.killed || error.signal) return resolve({ code: -1, stdout: out, stderr: err, timedOut: true, ms });
            resolve({ code: -1, stdout: out, stderr: err, timedOut: false, spawnError: String(error.code ?? error.message), ms });
          },
        );
      } catch (e) {
        resolve({ code: -1, stdout: "", stderr: "", timedOut: false, spawnError: e instanceof Error ? e.message : String(e), ms: Date.now() - started });
      }
    });
  }

  runInteractive(args: readonly string[], timeoutMs: number, onOutput: (stdoutSoFar: string, io: RunIo) => void): Promise<RunResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let cancelled = false;
      let done = false;
      let child: Spawned;
      const finish = (r: Omit<RunResult, "ms" | "stdout" | "stderr">) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ...r, stdout, stderr, ms: Date.now() - started });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child?.kill();
        } catch {
          // already gone
        }
      }, timeoutMs);
      try {
        child = this.cp.spawn(this.program, [...this.prefix, ...args], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: this.env });
      } catch (e) {
        finish({ code: -1, timedOut: false, spawnError: e instanceof Error ? e.message : String(e) });
        return;
      }
      const io: RunIo = {
        reply: (line) => {
          try {
            child.stdin?.write(line + "\n");
          } catch {
            // the program has ended
          }
        },
        cancel: () => {
          cancelled = true;
          try {
            child.kill();
          } catch {
            // already gone
          }
        },
      };
      child.stdin?.on("error", () => undefined);
      child.stdout?.on("data", (c) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += String(c);
        try {
          onOutput(stdout, io);
        } catch {
          // a failing handler must not leave the program running
          io.cancel();
        }
      });
      child.stderr?.on("data", (c) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += String(c);
      });
      child.on("error", (e) => finish({ code: -1, timedOut: false, spawnError: e.message }));
      child.on("close", (code) => {
        if (timedOut) finish({ code: -1, timedOut: true });
        else if (cancelled) finish({ code: -1, timedOut: false, cancelled: true });
        else finish({ code: typeof code === "number" ? code : -1, timedOut: false });
      });
    });
  }
}
