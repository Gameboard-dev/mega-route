// Writing a file in the vault that may be hidden.
//
// MEGA marks `.megaignore` hidden. On Windows, opening an existing hidden (or system) file with CREATE_ALWAYS fails
// with ERROR_ACCESS_DENIED unless the same attributes are passed (CreateFile's documentation), which Node reports as
// EPERM. Node's writeFile (and so Obsidian's adapter.write) opens with "w", that is CREATE_ALWAYS. So an existing file
// is opened with "r+" (OPEN_EXISTING), overwritten from the start and cut to the new length, which keeps its
// attributes (it stays hidden); only a missing file is created, with "wx". The bytes are read back afterwards.

export interface FileHandleLike {
  write(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>;
  truncate(len: number): Promise<void>;
  datasync(): Promise<void>;
  close(): Promise<void>;
}

export interface WriteFs {
  open(path: string, flags: "r+" | "wx"): Promise<FileHandleLike>;
  readFile(path: string): Promise<Uint8Array>;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Writes `text` (UTF-8) to `path` in place, keeping an existing file's attributes, and checks it was written. */
export async function writeInPlace(fs: WriteFs, path: string, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  let fh: FileHandleLike;
  try {
    fh = await fs.open(path, "r+");
  } catch (e) {
    if ((e as { code?: string }).code !== "ENOENT") throw e;
    fh = await fs.open(path, "wx");
  }
  try {
    let done = 0;
    while (done < bytes.length) {
      const { bytesWritten } = await fh.write(bytes, done, bytes.length - done, done);
      if (bytesWritten <= 0) throw new Error(`writing stopped after ${done} of ${bytes.length} bytes`);
      done += bytesWritten;
    }
    await fh.truncate(bytes.length);
    await fh.datasync();
  } finally {
    await fh.close();
  }
  const back = await fs.readFile(path);
  if (!sameBytes(new Uint8Array(back), bytes)) throw new Error(`${path} does not hold what was written (read back ${back.length} bytes, wrote ${bytes.length})`);
}

/** What to tell the user when a write still fails: what, where, why, and what to do. */
export function writeFailure(path: string, e: unknown): string {
  const code = (e as { code?: string }).code;
  const why = e instanceof Error ? e.message : String(e);
  const what =
    code === "EPERM" || code === "EACCES"
      ? "Windows refused to change it. Check that no other program holds it open or has made it read-only (right-click → Properties: Read-only unticked), and that your account may change files in the vault; then try again."
      : code === "EBUSY"
        ? "Another program is using it (the MEGA desktop app or an antivirus may be scanning it). Wait a moment and try again."
        : code === "ENOSPC"
          ? "The disk is full."
          : "See the log for details.";
  return `Could not write ${path}: ${why}. ${what}`;
}
