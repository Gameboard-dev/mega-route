// Reading MEGAcmd's answers. The formats are those of MEGAcmd 2.x (src/megacmdexecuter.cpp, src/sync_command.cpp):
// lists are asked for with `--col-separator` so that no column is padded or cut, and the header row names the columns.
// Anything that does not parse is reported as such, never guessed.

import type { RunResult } from "./runner.ts";

/** The column separator asked of MEGAcmd. It cannot occur in a Windows path, and is unlikely in a MEGA folder name. */
export const COL_SEP = "~|~";

/** MEGAcmd's own error codes (src/megacmdcommonutils.h), as the client returns them: made positive. */
export const MCMD = {
  EARGS: 51,
  INVALIDEMAIL: 52,
  NOTFOUND: 53,
  INVALIDSTATE: 54,
  INVALIDTYPE: 55,
  NOTPERMITTED: 56,
  NOTLOGGEDIN: 57,
  NOFETCH: 58,
  EUNEXPECTED: 59,
  REQCONFIRM: 60,
  EXISTS: 64,
} as const;

export type Outcome =
  | { kind: "ok" }
  | { kind: "not-logged-in"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "exists"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "not-started"; message: string }
  | { kind: "failed"; message: string };

/** What a call's result means, with a message that says what failed and why. */
export function outcome(r: RunResult, what: string): Outcome {
  const text = firstLines(r.stderr || r.stdout);
  if (r.spawnError) return { kind: "not-started", message: `${what}: MEGAcmd could not be started (${r.spawnError}).` };
  if (r.timedOut) return { kind: "timeout", message: `${what}: MEGAcmd did not answer within the time limit (${Math.round(r.ms / 1000)} s).` };
  if (r.code === 0) return { kind: "ok" };
  if (r.code === MCMD.NOTLOGGEDIN || /not logged in/i.test(text)) return { kind: "not-logged-in", message: `${what}: MEGAcmd is not signed in to a MEGA account.` };
  if (r.code === MCMD.NOTFOUND) return { kind: "not-found", message: `${what}: ${text || "not found"}` };
  if (r.code === MCMD.EXISTS) return { kind: "exists", message: `${what}: ${text || "already exists"}` };
  return { kind: "failed", message: `${what}: MEGAcmd answered with code ${r.code}${text ? `: ${text}` : ""}` };
}

/** The first few non-empty lines of an output, for messages. */
export function firstLines(s: string, n = 3): string {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n)
    .join(" / ")
    .slice(0, 500);
}

/** `version`: "MEGAcmd version: 2.1.1.0: code 2010100". */
export function parseVersion(stdout: string): string | null {
  const m = /MEGAcmd version:\s*([0-9]+(?:\.[0-9]+){1,3})/i.exec(stdout);
  return m ? m[1] : null;
}

/** `whoami`: "Account e-mail: someone@example.com". */
export function parseWhoami(stdout: string): string | null {
  const m = /Account e-mail:\s*(\S+@\S+)/i.exec(stdout);
  return m ? m[1] : null;
}

/** An address shown partly: "someone@example.com" as "s***@e***.com". Never logged or shown in full. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${name[0] ?? ""}***${tld}`;
}

/**
 * MEGAcmd's RUN_STATE column as it is written: Pending, Loading, Running, Suspended or Disabled in the versions known.
 * Any other text is kept as it is (a newer MEGAcmd may add states), so the type is plain text.
 */
export type RunState = string;
/** MEGAcmd's STATUS column as it is written: NONE, Synced, Pending, Syncing or Processing in the versions known. */
export type SyncStatus = string;

export interface SyncRow {
  id: string;
  localPath: string;
  remotePath: string;
  runState: RunState;
  status: SyncStatus;
  /** "NO", "Sync Issues (N)", or MEGA's error code for the sync (e.g. "LOCAL_PATH_UNAVAILABLE"). */
  error: string;
  size: string;
  files: number | null;
  dirs: number | null;
}

export const SYNC_COLUMNS = ["ID", "LOCALPATH", "REMOTEPATH", "RUN_STATE", "STATUS", "ERROR", "SIZE", "FILES", "DIRS"] as const;

/** `sync --col-separator=… --output-cols=…`: a header row, then one row per sync. Other lines (notes) are skipped. */
export function parseSyncList(stdout: string, sep = COL_SEP): { rows: SyncRow[]; problems: string[] } {
  const rows: SyncRow[] = [];
  const problems: string[] = [];
  let header: string[] | null = null;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.includes(sep)) continue;
    const cells = line.split(sep).map((c) => c.trim());
    if (!header) {
      if (cells.includes("ID") && cells.includes("LOCALPATH")) header = cells;
      else problems.push(`Unexpected line before the header: ${line.slice(0, 200)}`);
      continue;
    }
    if (cells.length !== header.length) {
      problems.push(`A row has ${cells.length} columns, the header ${header.length}: ${line.slice(0, 200)}`);
      continue;
    }
    const get = (name: string) => {
      const i = header!.indexOf(name);
      return i >= 0 ? cells[i] : "";
    };
    const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
    rows.push({
      id: get("ID"),
      localPath: get("LOCALPATH"),
      remotePath: get("REMOTEPATH"),
      runState: get("RUN_STATE"),
      status: get("STATUS"),
      error: get("ERROR"),
      size: get("SIZE"),
      files: num(get("FILES")),
      dirs: num(get("DIRS")),
    });
  }
  return { rows, problems };
}

/** MEGAcmd's sizes ("12.34 MB", "0.00  B") → bytes (null when it does not parse). */
export function sizeToBytes(s: string): number | null {
  const m = /^([0-9.]+)\s*([KMGTP]?)B$/.exec(s.trim());
  if (!m) return null;
  const pow = { "": 0, K: 1, M: 2, G: 3, T: 4, P: 5 }[m[2] as "" | "K" | "M" | "G" | "T" | "P"];
  return Number(m[1]) * Math.pow(1024, pow);
}

export interface TransferSummary {
  downloads: number;
  downloaded: string;
  downloadTotal: string;
  downloadPercent: number | null;
  uploads: number;
  uploaded: string;
  uploadTotal: string;
  uploadPercent: number | null;
}

const SIZE = String.raw`([0-9.]+\s+[KMGTP]?B)`;
const PCT = String.raw`([0-9.]+|-+)%`;
const SUMMARY_ROW = new RegExp(String.raw`^\s*(\d+)\s+${SIZE}\s+${SIZE}\s+${PCT}\s+(\d+)\s+${SIZE}\s+${SIZE}\s+${PCT}\s*$`);

/** `transfers --summary`: a header line ("NUM DOWNLOADS DOWNLOADED TOTAL % NUM UPLOADS …") and one line of values. */
export function parseTransferSummary(stdout: string): TransferSummary | null {
  for (const line of stdout.split(/\r?\n/)) {
    const m = SUMMARY_ROW.exec(line);
    if (!m) continue;
    const pct = (s: string) => (/^[0-9.]+$/.test(s) ? Number(s) : null);
    return {
      downloads: Number(m[1]),
      downloaded: m[2].replace(/\s+/g, " "),
      downloadTotal: m[3].replace(/\s+/g, " "),
      downloadPercent: pct(m[4]),
      uploads: Number(m[5]),
      uploaded: m[6].replace(/\s+/g, " "),
      uploadTotal: m[7].replace(/\s+/g, " "),
      uploadPercent: pct(m[8]),
    };
  }
  return null;
}

export interface TransferRow {
  /** MEGAcmd's arrow: ⇓ download, ⇑ upload, ⇵ a sync's transfer, ⏫ a backup's. */
  type: string;
  tag: string;
  source: string;
  destination: string;
  /** "45.10%" and the like, as MEGAcmd prints it. */
  progress: string;
  /** QUEUED, ACTIVE, PAUSED, RETRYING, COMPLETING, COMPLETED, CANCELLED, FAILED (src/megacmdutils.cpp). */
  state: string;
}

export const TRANSFER_COLUMNS = ["TYPE", "TAG", "SOURCEPATH", "DESTINYPATH", "PROGRESS", "STATE"] as const;

/** `transfers [--show-syncs] --col-separator=… --output-cols=TYPE,TAG,SOURCEPATH,DESTINYPATH,PROGRESS,STATE`. */
export function parseTransferList(stdout: string, sep = COL_SEP): TransferRow[] {
  const out: TransferRow[] = [];
  let header: string[] | null = null;
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.includes(sep)) continue;
    const cells = raw.split(sep).map((c) => c.trim());
    if (!header) {
      if (cells.includes("TAG") && cells.includes("STATE")) header = cells;
      continue;
    }
    const get = (name: string) => {
      const i = header!.indexOf(name);
      return i >= 0 && i < cells.length ? cells[i] : "";
    };
    out.push({ type: get("TYPE"), tag: get("TAG"), source: get("SOURCEPATH"), destination: get("DESTINYPATH"), progress: get("PROGRESS"), state: get("STATE") });
  }
  return out;
}

/** States of a transfer that is still to run or running (the others have ended). */
export const LIVE_TRANSFER_STATES = new Set(["QUEUED", "ACTIVE", "PAUSED", "RETRYING", "COMPLETING"]);

/** `sync-issues --col-separator=…`: rows of ISSUE_ID, PARENT_SYNC, REASON. */
export function parseSyncIssues(stdout: string, sep = COL_SEP): { id: string; sync: string; reason: string }[] {
  const out: { id: string; sync: string; reason: string }[] = [];
  let header: string[] | null = null;
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.includes(sep)) continue;
    const cells = raw.split(sep).map((c) => c.trim());
    if (!header) {
      if (cells.includes("ISSUE_ID")) header = cells;
      continue;
    }
    const get = (name: string) => {
      const i = header!.indexOf(name);
      return i >= 0 && i < cells.length ? cells[i] : "";
    };
    out.push({ id: get("ISSUE_ID"), sync: get("PARENT_SYNC"), reason: get("REASON") });
  }
  return out;
}

/** `ls <folder>`: the names in it, one per line (a "<folder>:" heading line, if printed, is left out). */
export function parseLs(stdout: string, folder: string): string[] {
  const heading = new Set([`${folder}:`, `${folder}/:`]);
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !heading.has(l));
}

/** Process names in `tasklist /FO CSV /NH` (Windows) or `ps -A -o comm=` (macOS, Linux) output. */
export function parseProcessNames(stdout: string, windows: boolean): string[] {
  const names: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (windows) {
      const m = /^"([^"]*)"/.exec(line);
      if (m) names.push(m[1]);
    } else {
      const base = line.split("/").pop() ?? line;
      names.push(base);
    }
  }
  return names;
}
