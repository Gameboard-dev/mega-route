// The plugin's settings in data.json (shared by every device that syncs the vault), the per-device settings, and the
// move from the 2.x settings.

export const SETTINGS_VERSION = 3;

/** Settings kept in data.json. Nothing here is ever run or used as a program path. */
export interface Settings {
  settingsVersion: number;
  /** The MEGA folder the vault syncs with, from the top of the Cloud Drive (e.g. /RAG). */
  remoteFolder: string;
  /** Glob patterns of vault paths to leave out (one per line). */
  excludePatterns: string;
  /** Glob patterns of vault paths to sync even when another rule leaves them out. */
  includePatterns: string;
  /** Sync Obsidian's configuration folder (MEGA's default rules leave out every name starting with a dot). */
  syncConfigFolder: boolean;
  showStatusBar: boolean;
  showRibbon: boolean;
  /** The log pane: follow new lines. */
  logAutoscroll: boolean;
  /** The log pane: which lines to show. */
  logFilter: "all" | "plugin" | "megacmd" | "sync";
}

/** Settings of this device only (Obsidian's per-vault localStorage), never synced with the vault. */
export interface DeviceSettings {
  /** MEGAcmd's client program; empty means the default place for this system. */
  clientPath: string;
  /** Start MEGAcmd's server when Obsidian starts (off by default: the user starts the sync). */
  startServerOnLoad: boolean;
  /** Seconds between status checks while the sync is idle and Obsidian is focused. */
  idlePollSeconds: number;
  /** The log pane wraps long lines (else it scrolls sideways). */
  logWrap: boolean;
}

export const DEFAULT_EXCLUDES = [".git/**", "node_modules/**"].join("\n");

export function defaultSettings(vaultName: string): Settings {
  const name = vaultName.replace(/[\u0000-\u001f"\\/]/g, "").trim() || "Obsidian";
  return {
    settingsVersion: SETTINGS_VERSION,
    remoteFolder: `/${name}`,
    excludePatterns: DEFAULT_EXCLUDES,
    includePatterns: "",
    syncConfigFolder: true,
    showStatusBar: true,
    showRibbon: true,
    logAutoscroll: true,
    logFilter: "all",
  };
}

export const DEFAULT_DEVICE: DeviceSettings = { clientPath: "", startServerOnLoad: false, idlePollSeconds: 30, logWrap: true };

/**
 * Keys under which 2.x kept MEGA sign-in data in data.json (email, password, two-factor code, session, its settings
 * passphrase, and its encrypted form). 3.x never uses them: they are removed at load, never copied anywhere, and their
 * values are never read beyond deleting the key.
 */
export const LEGACY_CREDENTIAL_KEYS = ["email", "password", "secondFactorCode", "session", "settingsPassword", "secretsEncrypted", "secretsBlob"];

export interface Migration {
  /** The data to save as data.json. */
  data: Record<string, unknown>;
  settings: Settings;
  /** Whether this load moved settings from 2.x. */
  migrated: boolean;
  /** Whether 2.x sign-in data was found (and left out of `data`): data.json must be saved to remove it. */
  credentialsRemoved: boolean;
  /** The 2.x settings and state that no longer apply (never the sign-in data), to keep in a backup file. */
  dropped: Record<string, unknown> | null;
  /** What happened, for the log (no values of the sign-in data). */
  notes: string[];
}

const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** `o` without the 2.x sign-in keys, and whether it had any. The values are not looked at. */
export function withoutCredentials(o: Record<string, unknown>): { rest: Record<string, unknown>; removed: boolean } {
  const rest: Record<string, unknown> = {};
  let removed = false;
  for (const k of Object.keys(o)) {
    if (LEGACY_CREDENTIAL_KEYS.includes(k)) removed = true;
    else rest[k] = o[k];
  }
  return { rest, removed };
}

/**
 * Reads data.json (any version) into the current settings. Only settings that still apply are carried over; the 2.x
 * sign-in data is dropped (and `credentialsRemoved` says so, so the caller saves data.json without it).
 */
export function migrate(raw: unknown, vaultName: string): Migration {
  const d = defaultSettings(vaultName);
  const whole: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const { rest: src, removed } = withoutCredentials(whole);
  const notes: string[] = [];
  if (removed) notes.push("Removed the sign-in data version 2 stored in data.json (3.x never uses it; MEGAcmd keeps its own session).");

  if (typeof src.settingsVersion === "number" && src.settingsVersion >= SETTINGS_VERSION) {
    const filter = src.logFilter;
    const settings: Settings = {
      settingsVersion: SETTINGS_VERSION,
      remoteFolder: str(src.remoteFolder, d.remoteFolder),
      excludePatterns: str(src.excludePatterns, d.excludePatterns),
      includePatterns: str(src.includePatterns, d.includePatterns),
      syncConfigFolder: bool(src.syncConfigFolder, d.syncConfigFolder),
      showStatusBar: bool(src.showStatusBar, d.showStatusBar),
      showRibbon: bool(src.showRibbon, d.showRibbon),
      logAutoscroll: bool(src.logAutoscroll, d.logAutoscroll),
      logFilter: filter === "plugin" || filter === "megacmd" || filter === "sync" ? filter : "all",
    };
    return { data: { ...settings }, settings, migrated: false, credentialsRemoved: removed, dropped: null, notes };
  }

  const isLegacy = Object.keys(whole).length > 0;
  const settings: Settings = { ...d };
  if (isLegacy) {
    // 2.x: "Base folder" (at the top of the Cloud Drive) and "Remote sub-folder" inside it.
    const base = str(src.baseFolder, "").trim().replace(/^\/+|\/+$/g, "");
    const sub = str(src.remoteSubFolder, "").trim().replace(/^\/+|\/+$/g, "");
    if (base) {
      settings.remoteFolder = "/" + [base, sub].filter(Boolean).join("/");
      notes.push(`MEGA folder ${settings.remoteFolder}, from 2.x's base folder "${base}"${sub ? ` and sub-folder "${sub}"` : ""}.`);
    }
    if (typeof src.excludePatterns === "string") settings.excludePatterns = src.excludePatterns;
    if (typeof src.includePatterns === "string") settings.includePatterns = src.includePatterns;
    if (typeof src.syncVaultConfig === "boolean") settings.syncConfigFolder = src.syncVaultConfig;
    if (typeof src.showStatusBar === "boolean") settings.showStatusBar = src.showStatusBar;
    if (typeof src.showRibbon === "boolean") settings.showRibbon = src.showRibbon;
    notes.push("Carried over from 2.x: the exclude and include patterns, syncing the configuration folder, the status bar and ribbon switches.");
    for (const k of ["ignorePathsRegex", "onlyAllowPathsRegex"]) {
      if (typeof src[k] === "string" && (src[k] as string).trim()) notes.push(`Not carried over: ${k} (JavaScript regular expressions have no exact MEGA equivalent); add MEGA rules to .megaignore by hand if needed.`);
    }
  }
  return { data: { ...settings }, settings, migrated: isLegacy, credentialsRemoved: removed, dropped: isLegacy ? src : null, notes };
}

export function readDevice(raw: unknown): DeviceSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const poll = typeof r.idlePollSeconds === "number" && Number.isFinite(r.idlePollSeconds) ? Math.min(600, Math.max(10, Math.round(r.idlePollSeconds))) : DEFAULT_DEVICE.idlePollSeconds;
  return { clientPath: str(r.clientPath, ""), startServerOnLoad: bool(r.startServerOnLoad, false), idlePollSeconds: poll, logWrap: bool(r.logWrap, true) };
}
