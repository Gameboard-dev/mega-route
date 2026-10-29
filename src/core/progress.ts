// The progress of a sync run: files in sync ÷ files the sync covers, from 0% to 100%, never going back within a run.
//
// Where the numbers come from:
//   - files on MEGA: the FILES and SIZE columns of MEGAcmd's `sync` list, which the status check reads anyway. MEGAcmd
//     fills them from the SDK's getFolderInfo on the sync's MEGA folder (src/sync_command.cpp), which the SDK answers
//     from the node tree it keeps in memory (node->getCounter(), src/megaapi_impl.cpp): no request to MEGA, no extra
//     cost. They count files that have arrived on MEGA (an upload is only added when it completes).
//   - files in the vault the sync covers: a walk of the vault with the `.megaignore` rules applied (coverage.ts),
//     done when a run starts, when the vault changes, and at most once a minute while it runs.
// The transfer summary (`transfers --summary`) is MEGAcmd's queue of the moment (src/megacmdexecuter.cpp: it sums the
// transfers in the queue, and a finished transfer leaves it), so its total grows while MEGA's engine scans and adds
// files, and shrinks as they finish: it is shown as "files left", never as a percentage.
//
// In sync both sides hold the same files, so with L files in the vault (covered) and R on MEGA, min(L, R) ÷ max(L, R)
// rises to 100% as uploads (R towards L) or downloads (L towards R) complete. It is held at its highest value within a
// run, so it never goes back, and shown only when the run has at least SMALL_RUN files to do; a run of a few edits
// says "1 file to upload" instead of 99.98%.

import type { SyncRow, TransferRow, TransferSummary } from "./parse.ts";
import { sizeToBytes } from "./parse.ts";

export const SMALL_RUN = 50;

export interface Local {
  files: number;
  bytes: number;
  approximate: string[];
}

export type Progress =
  | { kind: "synced"; files: number | null; bytes: number | null }
  | { kind: "scanning"; up: number; down: number; leftBytes: number | null }
  | { kind: "few"; up: number; down: number; leftBytes: number | null }
  | { kind: "percent"; percent: number; done: number; total: number; doneBytes: number | null; totalBytes: number | null; up: number; down: number; leftBytes: number | null; approximate: boolean };

const BUSY = new Set(["Syncing", "Pending", "Processing"]);

export class ProgressTracker {
  private best = 0;
  private percentRun = false;

  /** Starts a new run (after the sync is reported in sync, or when it is created or resumed). */
  reset(): void {
    this.best = 0;
    this.percentRun = false;
  }

  update(mine: SyncRow | null, transfers: TransferSummary | null, local: Local | null): Progress | null {
    if (!mine) {
      this.reset();
      return null;
    }
    const remoteBytes = sizeToBytes(mine.size);
    if (mine.runState === "Running" && mine.status === "Synced") {
      this.reset();
      return { kind: "synced", files: mine.files, bytes: remoteBytes };
    }
    const up = transfers?.uploads ?? 0;
    const down = transfers?.downloads ?? 0;
    const left = transfers ? Math.max(0, (sizeToBytes(transfers.uploadTotal) ?? 0) - (sizeToBytes(transfers.uploaded) ?? 0)) + Math.max(0, (sizeToBytes(transfers.downloadTotal) ?? 0) - (sizeToBytes(transfers.downloaded) ?? 0)) : null;
    if (!BUSY.has(mine.status) && mine.runState !== "Loading" && mine.runState !== "Pending") return null;
    if (local === null || mine.files === null) {
      return { kind: up + down ? "few" : "scanning", up, down, leftBytes: left };
    }
    const total = Math.max(local.files, mine.files);
    const done = Math.min(local.files, mine.files);
    if (!this.percentRun && total - done < SMALL_RUN) {
      return { kind: up + down ? "few" : "scanning", up, down, leftBytes: left };
    }
    this.percentRun = true;
    const raw = total > 0 ? Math.floor((done / total) * 100) : 0;
    // While MEGA's engine still works, 100% waits for it to say "Synced".
    this.best = Math.max(this.best, Math.min(99, raw));
    const totalBytes = remoteBytes === null ? null : Math.max(local.bytes, remoteBytes);
    const doneBytes = remoteBytes === null ? null : Math.min(local.bytes, remoteBytes);
    return { kind: "percent", percent: this.best, done, total, doneBytes, totalBytes, up, down, leftBytes: left, approximate: local.approximate.length > 0 };
  }
}

/** No change in MEGA's files, bytes, the vault's count or the running transfers' progress for this long: "no progress". */
export const STALL_MS = 120_000;
/** The rates are measured over this window. */
const RATE_WINDOW_MS = 60_000;

export interface Activity {
  /** Files and bytes arriving per minute / second, over the last minute (null until 10 s of samples). */
  rate: { filesPerMin: number; bytesPerSec: number } | null;
  /** What MEGAcmd is transferring now: "uploading Lecture 3.pdf (45%)". */
  current: string | null;
  /** How long nothing has moved, when it is at least STALL_MS; else 0. */
  stalledMs: number;
  /** MEGAcmd's own word for why, when nothing moves. */
  stallReason: string | null;
}

/** A file's name from MEGAcmd's path, shortened in the middle to `max` characters. */
export function shortName(path: string, max = 40): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  if (name.length <= max) return name;
  const half = Math.floor((max - 1) / 2);
  return `${name.slice(0, half)}…${name.slice(name.length - (max - 1 - half))}`;
}

interface Sample {
  t: number;
  files: number;
  bytes: number;
}

/**
 * Watches a run's movement: MEGA's file and byte counts (uploads), the vault's count (downloads) and the running
 * transfers' own progress (one large file moves its percentage while no file is added). The rate shows the run is
 * alive; "no progress" is said only when none of these changed for STALL_MS.
 */
export class ActivityMeter {
  private samples: Sample[] = [];
  private lastChange = -1;
  private signature = "";

  reset(): void {
    this.samples = [];
    this.lastChange = -1;
    this.signature = "";
  }

  observe(now: number, mine: SyncRow | null, local: Local | null, current: TransferRow[], transfers: TransferSummary | null): Activity {
    const files = (mine?.files ?? 0) + (local?.files ?? 0);
    const bytesNow = (mine ? sizeToBytes(mine.size) ?? 0 : 0) + (local?.bytes ?? 0);
    const sig = [mine?.files, mine?.size, local?.files, ...current.map((c) => `${c.tag}:${c.progress}:${c.state}`)].join("|");
    if (sig !== this.signature || this.lastChange < 0) {
      this.signature = sig;
      this.lastChange = now;
    }
    this.samples.push({ t: now, files, bytes: bytesNow });
    while (this.samples.length > 2 && now - this.samples[0].t > RATE_WINDOW_MS) this.samples.shift();
    const first = this.samples[0];
    const dt = now - first.t;
    const rate = dt >= 10_000 ? { filesPerMin: Math.max(0, ((files - first.files) / dt) * 60_000), bytesPerSec: Math.max(0, ((bytesNow - first.bytes) / dt) * 1000) } : null;
    const active = current.find((c) => c.state === "ACTIVE") ?? current[0];
    // ⇑ upload, ⇓ download; a sync's (⇵) by which side is the local path (Windows: a drive or a \\?\ path).
    const isLocalPath = (s: string) => /^([A-Za-z]:|[\\/][\\/][?.][\\/])/.test(s);
    const verb = !active ? "" : active.type.includes("⇑") ? "uploading" : active.type.includes("⇓") ? "downloading" : isLocalPath(active.source) ? "uploading" : isLocalPath(active.destination) ? "downloading" : "transferring";
    const cur = active ? `${verb} ${shortName(active.source)}${active.progress ? ` (${active.progress.replace(/\.\d+%$/, "%")})` : ""}` : null;
    const stalledMs = now - this.lastChange >= STALL_MS ? now - this.lastChange : 0;
    let stallReason: string | null = null;
    if (stalledMs) {
      const states = new Set(current.map((c) => c.state));
      if (states.has("RETRYING")) stallReason = "a transfer is RETRYING (MEGA or the network is refusing it for now)";
      else if (states.has("PAUSED") && !states.has("ACTIVE")) stallReason = "its transfers are PAUSED";
      else if (current.length && !states.has("ACTIVE")) stallReason = "its transfers are QUEUED, none is active";
      else if (!transfers || transfers.uploads + transfers.downloads === 0) stallReason = `the sync's status is ${mine?.status ?? "unknown"} with no transfer queued (MEGA's engine is scanning or comparing)`;
      else stallReason = `the sync's status is ${mine?.status ?? "unknown"}`;
    }
    return { rate, current: cur, stalledMs, stallReason };
  }
}

/** 1234567 → "1,234,567". */
export function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Bytes, readably: "512 MB", "1.1 GB", "940 KB". */
export function bytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = i === 0 ? String(Math.round(v)) : v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}`;
}

const plural = (n: number, one: string) => `${count(n)} ${one}${n === 1 ? "" : "s"}`;

/** The queue, as words: "4,706 files to upload, 926 MB left". */
export function queueText(p: { up: number; down: number; leftBytes: number | null }): string {
  const parts: string[] = [];
  if (p.up) parts.push(`${plural(p.up, "file")} to upload`);
  if (p.down) parts.push(`${plural(p.down, "file")} to download`);
  if (parts.length && p.leftBytes) parts.push(`${bytes(p.leftBytes)} left`);
  return parts.join(", ");
}

/**
 * The status bar's words and the tooltip's sentence for a progress, with the run's activity: the rate (so a run is
 * never shown frozen while it moves), what is being transferred, and "no progress for N min" with MEGAcmd's reason
 * when nothing has moved for STALL_MS.
 */
export function progressText(p: Progress, a: Activity | null = null): { short: string; long: string; fraction: number | null } {
  const base = baseText(p);
  if (!a || p.kind === "synced") return base;
  const extra: string[] = [];
  let short = base.short;
  if (a.stalledMs) {
    const min = Math.floor(a.stalledMs / 60_000);
    short = `${short}, no progress ${min} min`;
    extra.push(`No progress for ${min} min: ${a.stallReason ?? "MEGAcmd gives no reason"}. See the log in the settings (MEGA-Route → Logs).`);
  } else if (a.rate && (a.rate.bytesPerSec >= 1 || a.rate.filesPerMin >= 1)) {
    if (a.rate.bytesPerSec >= 1024) short = `${short} · ${bytes(a.rate.bytesPerSec)}/s`;
    extra.push(`Rate over the last minute: ${a.rate.filesPerMin >= 1 ? `${count(a.rate.filesPerMin)} files/min, ` : ""}${bytes(a.rate.bytesPerSec)}/s.`);
  }
  if (a.current) extra.push(`Now ${a.current}.`);
  return { short, long: [base.long, ...extra].join(" "), fraction: base.fraction };
}

function baseText(p: Progress): { short: string; long: string; fraction: number | null } {
  switch (p.kind) {
    case "synced":
      return {
        short: "synced",
        long: `In sync, 100%${p.files !== null ? `: ${plural(p.files, "file")}${p.bytes !== null ? `, ${bytes(p.bytes)}` : ""} on MEGA` : ""}.`,
        fraction: null,
      };
    case "scanning": {
      const q = queueText(p);
      return { short: "scanning", long: `MEGA's sync engine is comparing the vault with MEGA${q ? `; ${q}` : ""}.`, fraction: null };
    }
    case "few": {
      const q = queueText(p);
      const first = p.up ? `${plural(p.up, "file")} to upload` : p.down ? `${plural(p.down, "file")} to download` : "working";
      return { short: `syncing: ${first}`, long: `Syncing${q ? `: ${q}` : ""}.`, fraction: null };
    }
    case "percent": {
      const q = queueText(p);
      const files = `${count(p.done)} of ${count(p.total)} files (${p.percent}%)`;
      const size = p.doneBytes !== null && p.totalBytes !== null ? `, ${bytes(p.doneBytes)} of ${bytes(p.totalBytes)}` : "";
      const approx = p.approximate ? " The file count is approximate (see the log)." : "";
      return { short: `syncing ${p.percent}%`, long: `Syncing: ${files}${size} in sync${q ? `; ${q}` : ""}.${approx}`, fraction: p.percent / 100 };
    }
  }
}
