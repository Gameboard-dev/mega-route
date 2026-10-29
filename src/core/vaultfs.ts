// The vault's files through Obsidian's adapter, for everything that does not need Node's fs: counting the files the
// sync covers, reading `.megaignore`, the copy of `.megaignore` kept before each write, and the plugin's own log file.
// Paths are vault-relative with "/" ("" is the top of the vault).
//
// Node's fs is used only where the adapter cannot do the job (see docs/disclosures.md): MEGAcmd's own files outside the
// vault (its client program, checked before it is run, and its log), and writing `.megaignore`, which MEGA marks hidden
// and which the adapter's write cannot replace on Windows (core/fsio.ts).

import type { AppendFs } from "./logfile.ts";
import type { WalkFs } from "./coverage.ts";

/** The part of Obsidian's DataAdapter used here. */
export interface AdapterLike {
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  stat(path: string): Promise<{ type: "file" | "folder"; size: number } | null>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

function name(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The vault, for counting the files the sync covers. Folders are listed by the adapter (which, unlike the vault's own
 * file list, includes hidden files and folders such as `.obsidian` and `.megaignore`); sizes come from the vault's file
 * list where it has the file (no disk access), else from the adapter.
 */
export function vaultWalk(adapter: AdapterLike, cachedSize: (path: string) => number | null): WalkFs {
  return {
    async list(path) {
      const l = await adapter.list(path);
      return { files: l.files.map(name), folders: l.folders.map(name) };
    },
    async size(path) {
      const known = cachedSize(path);
      if (known !== null) return known;
      const st = await adapter.stat(path);
      return st && st.type === "file" ? st.size : null;
    },
  };
}

/** The plugin's log file through the adapter (its folder is in the vault's configuration folder). */
export function adapterAppend(adapter: AdapterLike): AppendFs {
  return {
    appendFile: (path, data) => adapter.append(path, data),
    async stat(path) {
      const st = await adapter.stat(path);
      if (!st) throw Object.assign(new Error(`${path} does not exist`), { code: "ENOENT" });
      return { size: st.size };
    },
    rename: (from, to) => adapter.rename(from, to),
    async rm(path) {
      if (await adapter.exists(path)) await adapter.remove(path);
    },
  };
}

/** Reads a vault file through the adapter; null when it does not exist. */
export async function readVaultText(adapter: AdapterLike, path: string): Promise<string | null> {
  if (!(await adapter.exists(path))) return null;
  return adapter.read(path);
}
