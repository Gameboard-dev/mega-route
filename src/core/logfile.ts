// The plugin's own log, kept in a file in its folder as well as in memory, so that what happened before a reload (a
// sign-out cut short, a sync that seemed to stop) can still be read afterwards. Lines are already redacted (no
// password, code or full address ever reaches the log). The file is cut over to `<name>.1.log` at MAX_BYTES, so at most
// about twice that is kept. The plugin's folder is never synced (the fixed exclusions).

export interface AppendFs {
  appendFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

export const MAX_BYTES = 1024 * 1024;

export class LogFile {
  private pending: string[] = [];
  private writing = false;
  readonly path: string;
  private readonly fs: AppendFs;
  private readonly maxBytes: number;

  constructor(fs: AppendFs, path: string, maxBytes = MAX_BYTES) {
    this.fs = fs;
    this.path = path;
    this.maxBytes = maxBytes;
  }

  add(line: string): void {
    this.pending.push(line);
    if (this.pending.length > 5000) this.pending.splice(0, this.pending.length - 5000);
  }

  /** Writes what was added since the last flush. Failures are returned, not thrown (the log must never break the plugin). */
  async flush(): Promise<string | null> {
    if (this.writing || this.pending.length === 0) return null;
    this.writing = true;
    const lines = this.pending.splice(0);
    try {
      try {
        const st = await this.fs.stat(this.path);
        if (st.size > this.maxBytes) {
          const old = this.path.replace(/\.log$/, ".1.log");
          await this.fs.rm(old, { force: true });
          await this.fs.rename(this.path, old);
        }
      } catch {
        // no file yet
      }
      await this.fs.appendFile(this.path, lines.join("\n") + "\n", "utf8");
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      this.writing = false;
    }
  }
}
