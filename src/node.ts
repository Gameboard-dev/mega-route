// Node's modules, loaded only in the desktop app (Obsidian on phones and tablets has no Node), so that the plugin can
// at least load there and say it is for the desktop.

import type { ChildProcessApi } from "./core/runner.ts";
import type { WriteFs } from "./core/fsio.ts";
import type { AppendFs } from "./core/logfile.ts";

export interface NodeApis {
  cp: ChildProcessApi;
  fsp: {
    stat(path: string): Promise<{ size: number; ino: number; mtimeMs: number; isFile(): boolean }>;
    open(path: string, flags: "r"): Promise<{ read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>; close(): Promise<void> }>;
  };
  /** For files that may be hidden (writeInPlace in core/fsio.ts). */
  wfs: WriteFs;
  /** For the plugin's own log file (core/logfile.ts). */
  afs: AppendFs;
  path: { join(...parts: string[]): string };
  os: { homedir(): string; platform(): string };
  env: Record<string, string | undefined>;
}

export function loadNode(): NodeApis | null {
  try {
    const cp = require("child_process") as ChildProcessApi;
    const fs = require("fs") as { promises: NodeApis["fsp"] };
    const os = require("os") as NodeApis["os"];
    const proc = require("process") as { env: Record<string, string | undefined> };
    const path = require("path") as NodeApis["path"];
    return { cp, fsp: fs.promises, wfs: fs.promises as unknown as WriteFs, afs: fs.promises as unknown as AppendFs, path, os, env: proc.env };
  } catch {
    return null;
  }
}
