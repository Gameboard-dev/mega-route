// Node's modules, loaded only in the desktop app (Obsidian on phones and tablets has no Node), so that the plugin can
// at least load there and say it is for the desktop.
//
// Where they are used (docs/disclosures.md); everything else in the vault goes through Obsidian's adapter
// (core/vaultfs.ts):
//   - child_process: only in core/runner.ts, to run MEGAcmd's client (and the system's process list), as an argument
//     array with shell: false;
//   - fs, outside the vault: `fsp.stat` checks MEGAcmd's client program before it is run (core/locate.ts), and
//     `fsp.stat` / `fsp.open(…, "r")` read MEGAcmd's log file (core/log.ts), both in MEGAcmd's own folders;
//   - fs, in the vault: `wfs` writes `.megaignore` in place (core/fsio.ts), because MEGA marks it hidden and the
//     adapter's write cannot replace a hidden file on Windows.

import { Platform } from "obsidian";
import type { ChildProcessApi } from "./core/runner.ts";
import type { WriteFs } from "./core/fsio.ts";

export interface NodeApis {
  cp: ChildProcessApi;
  /** Read-only, for MEGAcmd's files outside the vault. */
  fsp: {
    stat(path: string): Promise<{ size: number; ino: number; mtimeMs: number; isFile(): boolean }>;
    open(path: string, flags: "r"): Promise<{ read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>; close(): Promise<void> }>;
  };
  /** Only for `.megaignore`, which may be hidden (writeInPlace in core/fsio.ts). */
  wfs: WriteFs;
  path: { join(...parts: string[]): string };
  os: { homedir(): string; platform(): string };
  env: Record<string, string | undefined>;
}

/**
 * Loads Node's modules with dynamic imports, only on the desktop (Obsidian's guard for Node built-ins); esbuild keeps
 * them external, so Obsidian's Electron provides them. Null on phones and tablets, or if they cannot be loaded.
 */
export async function loadNode(): Promise<NodeApis | null> {
  if (!Platform.isDesktop) return null;
  if (!Platform.isDesktopApp) return null;
  try {
    const [cp, fs, os, proc, path] = await Promise.all([import("child_process"), import("fs"), import("os"), import("process"), import("path")]);
    return {
      cp: cp as unknown as ChildProcessApi,
      fsp: fs.promises as unknown as NodeApis["fsp"],
      wfs: fs.promises as unknown as WriteFs,
      path,
      os,
      env: proc.env,
    };
  } catch {
    return null;
  }
}
