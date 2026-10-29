// The plugin's log (in memory, bounded) and a reader that follows MEGAcmd's own log file as it grows.

export type LogSource = "plugin" | "megacmd";
export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogLine {
  /** Milliseconds since 1970. */
  t: number;
  source: LogSource;
  level: LogLevel;
  text: string;
}

/** A ring of the last `capacity` lines, with listeners for new lines (the settings tab's log pane). */
export class LogBuffer {
  private readonly lines: LogLine[] = [];
  private readonly listeners = new Set<(added: LogLine[]) => void>();
  readonly capacity: number;

  constructor(capacity = 2000) {
    this.capacity = Math.max(10, capacity);
  }

  add(source: LogSource, level: LogLevel, text: string, t = Date.now()): void {
    const added = text
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .map((l) => ({ t, source, level, text: l.length > 4000 ? l.slice(0, 4000) + " …" : l }));
    if (!added.length) return;
    this.lines.push(...added);
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
    for (const f of this.listeners) {
      try {
        f(added);
      } catch {
        // a failing view must not stop the log
      }
    }
  }

  all(): readonly LogLine[] {
    return this.lines;
  }

  clear(): void {
    this.lines.length = 0;
  }

  subscribe(f: (added: LogLine[]) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
}

/** A log line as text; `withDate` (for the log file) adds the date and milliseconds. */
export function formatLine(l: LogLine, withDate = false): string {
  const d = new Date(l.t);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const time = withDate
    ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
    : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const tag = l.source === "plugin" ? "MEGA-Route" : "MEGAcmd";
  const lvl = l.level === "info" ? "" : ` ${l.level.toUpperCase()}`;
  return `${time} [${tag}${lvl}] ${l.text}`;
}

/** The part of Node's `fs/promises` the reader needs. */
export interface TailFs {
  stat(path: string): Promise<{ size: number; ino: number; mtimeMs: number }>;
  open(path: string, flags: "r"): Promise<{ read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>; close(): Promise<void> }>;
}

/**
 * Follows a log file: each `poll()` returns the complete lines added since the last one. A file that got shorter or was
 * replaced (MEGAcmd rotates its log) is read again from the start. The first poll returns only the last
 * `initialBytes`; a poll never reads more than `maxBytesPerPoll` (the rest is skipped, and the skip is reported).
 */
export class LogTail {
  private offset = -1;
  private ino = -1;
  private rest = "";
  private dropNext = false;
  readonly path: string;
  private readonly fs: TailFs;
  private readonly initialBytes: number;
  private readonly maxBytesPerPoll: number;

  constructor(fs: TailFs, path: string, initialBytes = 64 * 1024, maxBytesPerPoll = 512 * 1024) {
    this.fs = fs;
    this.path = path;
    this.initialBytes = initialBytes;
    this.maxBytesPerPoll = maxBytesPerPoll;
  }

  /** Lines added since the last poll; `missing` when the file does not exist (yet). */
  async poll(): Promise<{ lines: string[]; missing: boolean; skipped: number; restarted: boolean }> {
    let st: { size: number; ino: number };
    try {
      st = await this.fs.stat(this.path);
    } catch {
      return { lines: [], missing: true, skipped: 0, restarted: false };
    }
    let restarted = false;
    // Reading from the middle of the file: its first line is cut, so it is left out.
    let dropFirst = false;
    if (this.offset < 0) {
      this.offset = Math.max(0, st.size - this.initialBytes);
      dropFirst = this.offset > 0;
      this.ino = st.ino;
      this.rest = "";
    } else if (st.size < this.offset || (st.ino !== 0 && this.ino !== 0 && st.ino !== this.ino)) {
      this.offset = 0;
      this.ino = st.ino;
      this.rest = "";
      restarted = true;
    }
    let skipped = 0;
    if (st.size - this.offset > this.maxBytesPerPoll) {
      skipped = st.size - this.maxBytesPerPoll - this.offset;
      this.offset = st.size - this.maxBytesPerPoll;
      this.rest = "";
      dropFirst = true;
    }
    const length = st.size - this.offset;
    if (length <= 0) return { lines: [], missing: false, skipped, restarted };
    const buf = new Uint8Array(length);
    const fh = await this.fs.open(this.path, "r");
    let read = 0;
    try {
      while (read < length) {
        const { bytesRead } = await fh.read(buf, read, length - read, this.offset + read);
        if (bytesRead <= 0) break;
        read += bytesRead;
      }
    } finally {
      await fh.close();
    }
    this.offset += read;
    const text = this.rest + new TextDecoder("utf-8").decode(buf.subarray(0, read));
    const parts = text.split(/\r?\n/);
    this.rest = parts.pop() ?? "";
    if (dropFirst || this.dropNext) {
      // No line ended yet: the cut line is still being read, so it is dropped when it ends.
      this.dropNext = parts.length === 0;
      parts.shift();
    }
    if (this.rest.length > 64 * 1024) this.rest = this.rest.slice(-64 * 1024);
    return { lines: parts.filter((l) => l.length > 0), missing: false, skipped, restarted };
  }
}

/** The log pane's classes for its "Wrap lines" setting: wrapped lines, or whole lines with a horizontal scrollbar. */
export function wrapClasses(wrap: boolean): { add: string; remove: string } {
  return wrap ? { add: "is-wrap", remove: "is-nowrap" } : { add: "is-nowrap", remove: "is-wrap" };
}

/** Lines of MEGAcmd's log about syncs and transfers (the log pane's "sync and transfers only" filter). */
export const SYNC_LINE = /sync|transfer|upload|download|putnodes|debris|stall|conflict|megaignore|scan/i;
