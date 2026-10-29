// What the status bar, the ribbon icon and the settings tab say, worked out from what MEGAcmd reported.

import type { SyncRow, TransferRow, TransferSummary } from "./parse.ts";
import { sizeToBytes } from "./parse.ts";
import { progressText } from "./progress.ts";
import type { Activity, Progress } from "./progress.ts";

export interface State {
  checkedAt: number;
  client: { path: string | null; found: boolean; reason?: string; version?: string | null };
  /** MEGAcmd's background server. */
  server: "running" | "stopped" | "unknown";
  /** The MEGA desktop app (MEGAsync). */
  desktopApp: "running" | "not-running" | "unknown";
  account: { signedIn: boolean | null; masked?: string };
  /** Every sync MEGAcmd has on this computer. */
  syncs: SyncRow[];
  /** The sync of this vault's folder, if there is one. */
  mine: SyncRow | null;
  transfers: TransferSummary | null;
  /** The sync's transfers MEGAcmd is running now (the first few), for "uploading <name>". */
  current: TransferRow[];
  issues: { id: string; sync: string; reason: string }[];
  /** The last failure, said in full (what, where, why). */
  error: string | null;
  /** The action running now (sign-in, sign-out, creating the sync …), during which no other may start. */
  operation: string | null;
}

export function emptyState(): State {
  return {
    checkedAt: 0,
    client: { path: null, found: false },
    server: "unknown",
    desktopApp: "unknown",
    account: { signedIn: null },
    syncs: [],
    mine: null,
    transfers: null,
    current: [],
    issues: [],
    error: null,
    operation: null,
  };
}

export const INSTALL_URL = "https://mega.io/cmd";
export const NOT_INSTALLED_TIP = `MEGAcmd is not installed. Install it from ${INSTALL_URL}, then restart Obsidian or set MEGAcmd's folder in these settings.`;
export const START_FIRST_TIP = "Start MEGAcmd first (Server: Start MEGAcmd). It may already be signed in.";
export const SIGN_IN_FIRST_TIP = "Sign MEGAcmd in to your MEGA account first.";

export interface Control {
  enabled: boolean;
  /** Why it is greyed out, and what to do (shown on hover and under the control). */
  tip: string | null;
}

/** Which of the settings' controls can be used now, and why not. Everything that needs MEGAcmd is greyed out without it. */
export function controls(s: State): { start: Control; stop: Control; signIn: Control; signOut: Control; create: Control; change: Control } {
  const on: Control = { enabled: true, tip: null };
  const off = (tip: string): Control => ({ enabled: false, tip });
  if (!s.client.found) {
    const c = off(NOT_INSTALLED_TIP);
    return { start: c, stop: c, signIn: c, signOut: c, create: c, change: c };
  }
  if (s.operation) {
    const c = off(`${s.operation} is in progress: wait for it to finish.`);
    return { start: c, stop: c, signIn: c, signOut: c, create: c, change: c };
  }
  const running = s.server === "running";
  const startTip = s.server === "unknown" ? "Whether MEGAcmd runs could not be checked; press Refresh." : START_FIRST_TIP;
  return {
    start: s.server === "stopped" ? on : off(running ? "MEGAcmd is running." : startTip),
    stop: running ? on : off("MEGAcmd is not running."),
    signIn: !running ? off(startTip) : s.account.signedIn === true ? off("MEGAcmd is already signed in.") : on,
    signOut: !running ? off(startTip) : s.account.signedIn === true ? on : off("MEGAcmd is not signed in."),
    create: !running ? off(startTip) : s.account.signedIn !== true ? off(SIGN_IN_FIRST_TIP) : s.mine ? off("This vault already has a sync.") : on,
    change: !running ? off(startTip) : s.mine ? on : off("MEGAcmd has no sync of this vault."),
  };
}

/**
 * A sign-out that was cut short (its note is still there at the next start): how far it got, from MEGAcmd's real
 * state. Null while that state is not known yet (the account not yet asked).
 */
export function interruptedSignOut(s: State): { finished: boolean; text: string } | null {
  if (s.account.signedIn === null) return null;
  if (s.account.signedIn === false) return { finished: true, text: "The last sign-out finished: MEGAcmd is signed out." };
  const m = s.mine;
  const paused = !!m && (m.runState === "Disabled" || m.runState === "Suspended");
  const where = m ? (paused ? "the sync is paused" : "the sync is running") : "there is no sync of this vault";
  return {
    finished: false,
    text: `The last sign-out did not finish (Obsidian closed or reloaded during it): MEGAcmd is still signed in and ${where}. Sign out again${paused ? ", or resume the sync" : ""}.`,
  };
}

export type Level = "ok" | "busy" | "paused" | "attention" | "error" | "off";

export interface Shown {
  level: Level;
  /** For the status bar: a few words. */
  short: string;
  /** For tooltips and the settings: a full sentence or two. */
  long: string;
  /** 0..1 while transfers run, else null. */
  progress: number | null;
}

export { sizeToBytes } from "./parse.ts";

const BUSY_STATUS = new Set(["Syncing", "Pending", "Processing"]);

export function isBusy(s: State): boolean {
  const m = s.mine;
  if (!m) return false;
  return BUSY_STATUS.has(m.status) || m.runState === "Loading" || m.runState === "Pending";
}

/** What to show; `progress` comes from the plugin's ProgressTracker (progress.ts), when it has one. */
export function describe(s: State, progress: Progress | null = null, activity: Activity | null = null): Shown {
  const none = (level: Level, short: string, long: string): Shown => ({ level, short, long, progress: null });
  if (!s.client.found) return none("off", "MEGAcmd not found", `MEGAcmd was not found on this computer${s.client.reason ? ` (${s.client.reason})` : ""}. Install it from MEGA, or set its path in the settings.`);
  if (s.server === "unknown") return none("attention", "status unknown", s.error ?? "Whether MEGAcmd's server runs could not be checked.");
  if (s.server === "stopped") return none("off", "MEGAcmd not running", "MEGAcmd's server is not running, so no sync runs. Start it from this menu or the settings.");
  if (s.account.signedIn === false) return none("attention", "not signed in", "MEGAcmd is not signed in to a MEGA account. Sign in under Settings → MEGA-Route → Sign in to MEGA.");
  if (s.account.signedIn === null && s.error) return none("attention", "status unknown", s.error);
  const m = s.mine;
  if (!m) return none("off", "no sync", "MEGAcmd has no sync of this vault. Create one in the settings.");
  const where = `${m.localPath} ↔ ${m.remotePath}`;
  if (m.error && m.error !== "NO" && !m.error.startsWith("Sync Issues")) {
    return none("error", `error: ${m.error}`, `The sync ${where} stopped with MEGA's error ${m.error}. See the log in the settings, and Troubleshooting in the plugin's documentation.`);
  }
  if (s.issues.length || m.error.startsWith("Sync Issues")) {
    const n = s.issues.length || Number(/\((\d+)\)/.exec(m.error)?.[1] ?? 0);
    const first = s.issues[0]?.reason;
    return none("attention", `${n} sync issue${n === 1 ? "" : "s"}`, `MEGA's sync engine stopped on ${n} item${n === 1 ? "" : "s"} it cannot decide alone${first ? ` (first: ${first})` : ""}. Run "sync-issues" in MEGAcmd to see and settle them.`);
  }
  if (m.runState === "Disabled" || m.runState === "Suspended") return none("paused", "paused", `The sync ${where} is paused (${m.runState}). Resume it from this menu or the settings.`);
  if (m.runState === "Pending" || m.runState === "Loading") return none("busy", "starting", `The sync ${where} is starting (${m.runState}).`);
  if (m.status === "Synced") {
    const t = progressText(progress ?? { kind: "synced", files: m.files, bytes: sizeToBytes(m.size) });
    return none("ok", "synced", `${where}: ${t.long}`);
  }
  if (BUSY_STATUS.has(m.status)) {
    const up = s.transfers?.uploads ?? 0;
    const down = s.transfers?.downloads ?? 0;
    const t = progressText(progress ?? { kind: up + down ? "few" : "scanning", up, down, leftBytes: null }, activity);
    return { level: "busy", short: t.short, long: `${where}: ${t.long}`, progress: t.fraction };
  }
  return none("busy", "checking", `The sync ${where} reports status ${m.status || "unknown"}.`);
}
