// MEGA-Route: keeps a two-way sync between this vault and a MEGA folder, run by MEGA's command-line tool MEGAcmd.
// The plugin never moves a file itself: it checks MEGAcmd, creates, pauses, resumes and removes the sync, writes the
// exclusions to .megaignore, and shows the sync's state and logs. See README.md and docs/.

import { FileSystemAdapter, Menu, Notice, Platform, Plugin } from "obsidian";
import { Controller } from "./core/controller.ts";
import type { ControllerEnv, SignInResult, SignInUi } from "./core/controller.ts";
import { LogBuffer, LogTail, formatLine } from "./core/log.ts";
import { LogFile } from "./core/logfile.ts";
import type { LogLevel } from "./core/log.ts";
import { checkClientPath, defaultClient, desktopAppProcessNames, pathsFor, processLister, serverProcessNames } from "./core/locate.ts";
import type { MegaCmdPaths, Platform as Sys } from "./core/locate.ts";
import type { IgnoreOptions } from "./core/megaignore.ts";
import { ProcessRunner } from "./core/runner.ts";
import { redactMegaCmdLine } from "./core/secrets.ts";
import { writeFailure, writeInPlace } from "./core/fsio.ts";
import { countCovered, parseRules } from "./core/coverage.ts";
import { adapterAppend, readVaultText, vaultWalk } from "./core/vaultfs.ts";
import { ActivityMeter, ProgressTracker } from "./core/progress.ts";
import type { Activity, Local, Progress } from "./core/progress.ts";
import { DEFAULT_DEVICE, migrate, readDevice, SETTINGS_VERSION, withoutCredentials } from "./core/settings.ts";
import type { DeviceSettings, Settings } from "./core/settings.ts";
import { describe, emptyState, interruptedSignOut, isBusy } from "./core/status.ts";
import type { Shown, State } from "./core/status.ts";
import { loadNode } from "./node.ts";
import type { NodeApis } from "./node.ts";
import { confirm, confirmCreate } from "./ui/modals.ts";
import { MegaRouteSettingTab, MobileSettingTab } from "./ui/settingsTab.ts";

/** Per-device settings, through Obsidian's App.loadLocalStorage / saveLocalStorage (per vault and per device). */
const DEVICE_KEY = "mega-route-device";
const BACKUP_FILE = "settings-2.x-backup.json";
/** While the sync works: status every 5 s. */
const BUSY_POLL_MS = 5_000;
/** The version and the account are asked again every 5 minutes. */
const FULL_REFRESH_MS = 5 * 60_000;
/** While the sync works, the vault's covered files are counted again at most this often, and only if it changed. */
const COUNT_EVERY_MS = 60_000;
/** This device's note of a sign-out in progress (to find one cut short at the next start). */
const OP_KEY = "mega-route-operation";

export default class MegaRoutePlugin extends Plugin {
  settings!: Settings;
  /** data.json as saved: the settings, plus the 2.x sign-in data until the user deletes it. */
  data: Record<string, unknown> = {};
  device: DeviceSettings = { ...DEFAULT_DEVICE };
  readonly log = new LogBuffer(2000);
  controller: Controller | null = null;
  node: NodeApis | null = null;
  sys: Sys | null = null;
  paths: MegaCmdPaths | null = null;
  vaultPath = "";
  shown: Shown = describe(emptyState());
  private statusEl: HTMLElement | null = null;
  private ribbonEl: HTMLElement | null = null;
  private lastRefresh = 0;
  private lastFull = 0;
  private refreshing = false;
  private ignoreTimer: number | null = null;
  private readonly listeners = new Set<() => void>();

  async onload(): Promise<void> {
    if (!Platform.isDesktopApp) {
      this.addSettingTab(new MobileSettingTab(this.app, this));
      return;
    }
    this.node = await loadNode();
    await this.loadSettings();
    this.device = readDevice(this.app.loadLocalStorage(DEVICE_KEY));
    if (!this.node) {
      this.say("error", "Node's modules could not be loaded, so MEGAcmd cannot be run from this Obsidian.");
    }
    await this.setupController();

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mega-route-status", "mod-clickable");
    this.registerDomEvent(this.statusEl, "click", (e) => this.menu(e));
    this.ribbonEl = this.addRibbonIcon("cloud", "MEGA-Route", (e) => this.menu(e));
    this.ribbonEl.addClass("mega-route-ribbon");
    this.applyVisibility();
    this.render();

    this.addCommand({ id: "refresh-status", name: "Refresh the sync's status", callback: () => void this.refresh(true) });
    this.addCommand({ id: "pause-sync", name: "Pause the sync", callback: () => void this.change("pause") });
    this.addCommand({ id: "resume-sync", name: "Resume the sync", callback: () => void this.change("resume") });
    this.addCommand({ id: "open-settings", name: "Open settings and logs", callback: () => this.openSettings() });

    this.addSettingTab(new MegaRouteSettingTab(this.app, this));

    // The count of covered files is redone (at most once a minute while syncing) after the vault changed.
    const dirty = () => {
      this.countDirty = true;
    };
    this.registerEvent(this.app.vault.on("create", dirty));
    this.registerEvent(this.app.vault.on("delete", dirty));
    this.registerEvent(this.app.vault.on("rename", dirty));

    this.registerInterval(window.setInterval(() => this.tick(), 1000));
    this.registerDomEvent(window, "focus", () => {
      if (Date.now() - this.lastRefresh > 3000) void this.refresh(false);
    });
    this.app.workspace.onLayoutReady(async () => {
      if (this.device.startServerOnLoad && this.controller) {
        this.say("info", "Starting MEGAcmd's server, as set for this device (Start MEGAcmd with Obsidian).");
        await this.controller.startServer();
        this.lastFull = Date.now();
        this.afterRefresh();
      } else {
        await this.refresh(true);
      }
    });
    // The plugin's lines are also kept in mega-route.log in its folder (read it after a reload; never synced), written
    // through Obsidian's adapter.
    if (this.node) {
      const file = new LogFile(adapterAppend(this.app.vault.adapter), `${this.pluginDir()}/mega-route.log`);
      for (const l of this.log.all()) if (l.source === "plugin") file.add(formatLine(l, true));
      this.register(this.log.subscribe((added) => added.forEach((l) => l.source === "plugin" && file.add(formatLine(l, true)))));
      let failed = false;
      this.registerInterval(
        window.setInterval(() => {
          void file.flush().then((e) => {
            if (e && !failed) {
              failed = true;
              console.error(`MEGA-Route: could not write ${file.path}: ${e}`);
            }
          });
        }, 2000),
      );
      this.register(() => void file.flush());
    }
    this.say("info", `MEGA-Route ${this.manifest.version} loaded. It starts no sync itself: MEGAcmd runs the syncs it has.`);
  }

  onunload(): void {
    if (this.ignoreTimer !== null) window.clearTimeout(this.ignoreTimer);
    this.listeners.clear();
  }

  /** Adds a line to the plugin's log. */
  say(level: LogLevel, text: string): void {
    this.log.add("plugin", level, text);
  }

  // ---------------------------------------------------------------- settings

  async loadSettings(): Promise<void> {
    // data.json as Obsidian read it: anything at all until migrate() has checked it.
    const raw: unknown = await this.loadData();
    const m = migrate(raw, this.app.vault.getName());
    this.settings = m.settings;
    this.data = m.data;
    if (m.migrated) {
      if (m.dropped && Object.keys(m.dropped).length) {
        const path = `${this.pluginDir()}/${BACKUP_FILE}`;
        try {
          if (!(await this.app.vault.adapter.exists(path))) {
            await this.app.vault.adapter.write(path, JSON.stringify(m.dropped, null, 1));
            this.say("info", `The 2.x settings and sync state that no longer apply were kept in ${path} (without any sign-in data).`);
          }
        } catch (e) {
          this.say("error", `Could not keep the 2.x settings in ${path}: ${e instanceof Error ? e.message : String(e)}. The settings were not changed.`);
          // Without the backup, data.json is not rewritten: the migration is done in memory only, and again next time.
          for (const n of m.notes) this.say("info", n);
          return;
        }
      }
      for (const n of m.notes) this.say("info", n);
      await this.saveData(this.data);
      this.say("info", `Settings moved to version ${SETTINGS_VERSION}.`);
    } else if (m.credentialsRemoved) {
      // 3.0.x left 2.x's sign-in data in data.json: removed now (never copied anywhere; values never read).
      for (const n of m.notes) this.say("info", n);
      await this.saveData(this.data);
    }
    await this.cleanBackup();
  }

  /** Takes any 2.x sign-in data out of the 2.x settings backup (earlier 3.0.x never wrote it there; this makes sure). */
  private async cleanBackup(): Promise<void> {
    const path = `${this.pluginDir()}/${BACKUP_FILE}`;
    try {
      if (!(await this.app.vault.adapter.exists(path))) return;
      const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(path));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const { rest, removed } = withoutCredentials(parsed as Record<string, unknown>);
      if (!removed) return;
      await this.app.vault.adapter.write(path, JSON.stringify(rest, null, 1));
      this.say("info", `Removed sign-in data from ${path}.`);
    } catch (e) {
      this.say("warn", `Could not check ${path} for sign-in data: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async saveSettings(): Promise<void> {
    this.data = { ...this.settings };
    await this.saveData(this.data);
  }

  saveDevice(): void {
    this.app.saveLocalStorage(DEVICE_KEY, this.device);
  }

  pluginDir(): string {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }

  ignoreOptions(): IgnoreOptions {
    return {
      configDir: this.app.vault.configDir,
      pluginDir: this.pluginDir(),
      excludePatterns: this.settings.excludePatterns,
      includePatterns: this.settings.includePatterns,
      syncConfigFolder: this.settings.syncConfigFolder,
    };
  }

  // ---------------------------------------------------------------- MEGAcmd

  /** Finds MEGAcmd and builds the controller (again after the client path setting changes). */
  async setupController(): Promise<void> {
    const node = this.node;
    const adapter = this.app.vault.adapter;
    this.vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
    if (!node) {
      this.controller = null;
      return;
    }
    const plat = node.os.platform();
    const sys: Sys = { os: plat === "win32" ? "windows" : plat === "darwin" ? "macos" : "linux", env: node.env, home: node.os.homedir() };
    this.sys = sys;
    const wanted = this.device.clientPath.trim() || defaultClient(sys) || "";
    const check = await checkClientPath(sys, wanted, this.vaultPath, (p) => node.fsp.stat(p));
    this.paths = check.ok ? pathsFor(sys, check.path) : wanted ? pathsFor(sys, wanted) : null;
    const lister = processLister(sys);
    const ignorePath = node.path.join(this.vaultPath, ".megaignore");
    const backupPath = `${this.pluginDir()}/megaignore-before-last-write.txt`;
    const env: ControllerEnv = {
      windows: sys.os === "windows",
      vaultPath: this.vaultPath,
      client: check.ok ? new ProcessRunner(node.cp, check.path, [], node.env) : null,
      clientPath: check.ok ? check.path : wanted || null,
      clientProblem: check.ok ? undefined : check.reason,
      processes: lister ? new ProcessRunner(node.cp, lister.program, lister.args) : null,
      serverNames: serverProcessNames(sys.os),
      desktopAppNames: desktopAppProcessNames(sys.os),
      // Read through Obsidian's adapter.
      readIgnore: async () => {
        try {
          return await readVaultText(adapter, ".megaignore");
        } catch (e) {
          throw new Error(`Could not read .megaignore: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      writeIgnore: async (text) => {
        // The file as it was is kept once per write, beside the plugin's settings, before it is changed (adapter).
        let before: string | null = null;
        try {
          before = await readVaultText(adapter, ".megaignore");
        } catch {
          before = null;
        }
        if (before !== null) {
          try {
            await adapter.write(backupPath, before);
          } catch (e) {
            throw new Error(`.megaignore was not changed, because its copy could not be kept first. ${writeFailure(backupPath, e)}`);
          }
        }
        // Written with Node's fs, not the adapter: MEGA marks .megaignore hidden, and the adapter's write (Node's
        // writeFile, "w", CREATE_ALWAYS on Windows) cannot replace a hidden file there (EPERM). writeInPlace opens it
        // with "r+" and keeps its attributes. This is the plugin's only write with Node's fs (core/fsio.ts).
        try {
          await writeInPlace(node.wfs, ignorePath, text);
        } catch (e) {
          throw new Error(`${writeFailure(ignorePath, e)} Its previous content is in ${backupPath}.`);
        }
      },
      log: (level, text) => this.say(level, text),
    };
    this.controller = new Controller(env);
    if (check.ok) this.say("info", `MEGAcmd's client: ${check.path}`);
    else this.say("warn", `MEGAcmd not found: ${check.reason} Install MEGAcmd (Settings → MEGA-Route → MEGAcmd), or set the path of its client program for this device.`);
    if (!this.vaultPath) this.say("error", "The vault's folder on disk is unknown, so it cannot be synced.");
  }

  get state(): State {
    return this.controller?.state ?? emptyState();
  }

  /** Asks MEGAcmd for the current state (never while its server is stopped: that would start it). */
  async refresh(full: boolean): Promise<void> {
    if (!this.controller || this.refreshing) return;
    this.refreshing = true;
    try {
      const doFull = full || Date.now() - this.lastFull > FULL_REFRESH_MS;
      await this.controller.refresh(doFull);
      if (doFull) this.lastFull = Date.now();
    } catch (e) {
      this.say("error", `Checking the sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.refreshing = false;
      this.afterRefresh();
    }
  }

  /** Whether "signed out" was already said since MEGAcmd was last seen signed in (said once, never repeated). */
  private signedOutSaid = false;

  private afterRefresh(): void {
    this.lastRefresh = Date.now();
    // MEGAcmd keeps its session itself (its .megaCmd folder) and resumes it whenever its server starts, so a signed-out
    // MEGAcmd means the session has ended: signed out in MEGAcmd, closed from another MEGA app, or its files removed.
    // The plugin does not sign in again by itself (it keeps no password): it says so once, and waits for the user.
    const acc = this.state.account.signedIn;
    if (acc === true) this.signedOutSaid = false;
    else if (acc === false && this.state.server === "running" && !this.signedOutSaid && !this.state.operation) {
      this.signedOutSaid = true;
      new Notice("MEGA-Route is signed out of MEGA, so nothing syncs. Sign in again in MEGA-Route's settings.", 15000);
      this.say("warn", "MEGAcmd is not signed in to MEGA: no sync runs until you sign in again in the settings.");
    }
    this.reconcileOperation();
    // The vault's covered files are counted when a run starts and when the vault changed, at most once a minute while
    // the sync works, never while it is idle (progress.ts, coverage.ts).
    const busy = isBusy(this.state);
    if (this.state.mine && busy && !this.counting && (this.local === null || (this.countDirty && Date.now() - this.lastCount > COUNT_EVERY_MS) || !this.wasBusy)) {
      void this.countLocal();
    }
    if (!busy) this.meter.reset();
    this.wasBusy = busy;
    this.progress = this.tracker.update(this.state.mine, this.state.transfers, this.local);
    this.activity = busy ? this.meter.observe(Date.now(), this.state.mine, this.local, this.state.current, this.state.transfers) : null;
    this.show();
  }

  /** Works out what to show from the state, logs a change of kind, and redraws. */
  private show(): void {
    const before = this.shown;
    this.shown = describe(this.state, this.progress, this.activity);
    const op = this.opStatus;
    if (op?.running) {
      // An action running: the status bar says so (and the ribbon), so it never looks idle.
      this.shown = { level: "busy", short: op.short ?? "working…", long: op.text, progress: null };
    } else if (op && !op.ok && this.shown.level !== "error") {
      this.shown = { ...this.shown, long: `${this.shown.long} ${op.text}` };
    }
    // Logged when the kind of status changes, not at every percent.
    const kind = (s: Shown) => `${s.level} ${s.short.replace(/[\d,.%]+/g, "#").replace(/ · .*$/, "")}`;
    if (kind(before) !== kind(this.shown)) this.say(this.shown.level === "error" ? "error" : "info", `Status: ${this.shown.short}. ${this.shown.long}`);
    this.render();
    for (const f of this.listeners) f();
  }

  private readonly tracker = new ProgressTracker();
  private readonly meter = new ActivityMeter();
  private progress: Progress | null = null;
  private activity: Activity | null = null;
  private local: Local | null = null;
  private counting = false;
  private countDirty = true;
  private lastCount = 0;
  private wasBusy = false;

  /**
   * The action running or last finished, shown in the settings' sign-in section: a step with a spinner while it runs,
   * then its result, which stays until the next action (a failure also stays in the status bar's tooltip).
   */
  opStatus: { running: boolean; text: string; ok?: boolean; short?: string } | null = null;

  private setOp(running: boolean, text: string, ok?: boolean, short?: string): void {
    this.opStatus = { running, text, ok, short };
    this.show();
  }

  /**
   * A sign-out leaves a note in this device's storage when it starts, and removes it when it has finished. If Obsidian
   * closed or reloaded half-way, the note is still there at the next start; MEGAcmd's real state (whoami, sync) then
   * says how far it got, and the settings say so plainly.
   */
  private reconcileOperation(): void {
    if (this.state.operation) return;
    let note: { op: string; at: number } | null = null;
    try {
      note = this.app.loadLocalStorage(OP_KEY) as { op: string; at: number } | null;
    } catch {
      note = null;
    }
    if (!note || note.op !== "sign-out") return;
    const r = interruptedSignOut(this.state);
    if (!r) return; // not known yet
    this.app.saveLocalStorage(OP_KEY, null);
    this.say(r.finished ? "info" : "warn", r.text);
    this.setOp(false, r.text, r.finished);
  }

  /** Counts the vault's files that the sync covers, with the `.megaignore` rules as MEGA reads them. */
  private async countLocal(): Promise<void> {
    const node = this.node;
    if (!node || !this.vaultPath || this.counting) return;
    this.counting = true;
    try {
      const adapter = this.app.vault.adapter;
      let text: string | null = null;
      try {
        text = await readVaultText(adapter, ".megaignore");
      } catch {
        text = null;
      }
      // Through Obsidian's adapter (folder listings) and the vault's file list (sizes), not Node's fs.
      const walk = vaultWalk(adapter, (p) => this.app.vault.getFileByPath(p)?.stat.size ?? null);
      const c = await countCovered(walk, parseRules(text));
      this.local = { files: c.files, bytes: c.bytes, approximate: c.approximate };
      this.countDirty = false;
      this.lastCount = Date.now();
      this.say("debug", `Counted ${c.files} files (${c.bytes} bytes) the sync covers, in ${c.ms} ms.`);
      for (const a of c.approximate) this.say("info", `The file count for the progress is approximate: ${a}.`);
      this.progress = this.tracker.update(this.state.mine, this.state.transfers, this.local);
      this.show();
    } catch (e) {
      this.say("warn", `Could not count the vault's files for the progress: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.counting = false;
    }
  }

  /** Signs MEGAcmd out, after a confirmation that says what happens; each step shows in the settings as it runs. */
  async signOut(): Promise<void> {
    if (!this.controller) return;
    if (this.state.operation) {
      new Notice(`MEGA-Route: ${this.state.operation} is in progress: wait for it to finish.`);
      return;
    }
    const ok = await confirm(
      this.app,
      "Sign out of MEGA?",
      (el) => {
        el.createEl("p", { text: "MEGA-Route will, in this order, and stop at the first step that fails:" });
        const ol = el.createEl("ol");
        ol.createEl("li", { text: "Pause the sync of this vault: its transfers stop, and an upload that has not finished is not created on MEGA." });
        ol.createEl("li", { text: "Stop any other transfer in progress (nothing in the vault changes)." });
        ol.createEl("li", { text: "Sign MEGAcmd out: MEGA ends the session, and MEGAcmd deletes its saved session and its sync of this vault." });
        el.createEl("p", { text: "Your files stay as they are, in the vault and on MEGA. To sync again, sign in (your password, and the one-time code if two-factor authentication is on), then create the sync again in the settings." });
      },
      "Sign out",
      true,
    );
    if (!ok) return;
    this.app.saveLocalStorage(OP_KEY, { op: "sign-out", at: Date.now() });
    this.setOp(true, "Signing out: starting…", undefined, "signing out…");
    const r = await this.controller.signOut((n, of, text) => this.setOp(true, `Signing out: step ${n} of ${of}, ${text}…`, undefined, `signing out ${n}/${of}`));
    this.app.saveLocalStorage(OP_KEY, null);
    this.tracker.reset();
    this.meter.reset();
    this.local = null;
    new Notice(`MEGA-Route: ${r.message}`, r.ok ? 6000 : 15000);
    // The signed-out notice is not shown again on top of this one.
    if (r.ok) this.signedOutSaid = true;
    this.setOp(false, r.ok ? "Signed out of MEGA." : r.message, r.ok);
    this.afterRefresh();
  }

  /** Every second: decides whether a status check is due. While the sync works: every 5 s. While idle: only when
   *  Obsidian has the focus, every `idlePollSeconds`. Otherwise not at all. */
  private tick(): void {
    if (!this.controller || this.refreshing) return;
    const busy = isBusy(this.state);
    const focused = document.hasFocus();
    const every = busy ? BUSY_POLL_MS : focused ? this.device.idlePollSeconds * 1000 : 0;
    if (every && Date.now() - this.lastRefresh >= every) void this.refresh(false);
  }

  onStateChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  async change(action: "pause" | "resume" | "remove"): Promise<void> {
    if (!this.controller) return;
    if (!this.state.mine) await this.refresh(false);
    if (!this.state.mine) {
      new Notice("MEGA-Route: MEGAcmd has no sync of this vault.");
      return;
    }
    if (action === "remove") {
      const mine = this.state.mine;
      const ok = await confirm(
        this.app,
        "Remove the sync?",
        (el) => {
          el.createEl("p", { text: `MEGAcmd stops syncing ${mine.localPath} with ${mine.remotePath} and forgets this sync.` });
          el.createEl("p", { text: "No file is deleted, in the vault or on MEGA. To sync again later, create the sync again (both sides are then compared afresh)." });
        },
        "Remove the sync",
        true,
      );
      if (!ok) return;
    }
    const r = await this.controller.change(action);
    new Notice(`MEGA-Route: ${r.message}`, r.ok ? 4000 : 10000);
    if (!r.ok) this.say("error", r.message);
    this.afterRefresh();
  }

  /** The checks, the dialog, then the sync's creation. */
  async createSync(): Promise<void> {
    if (!this.controller) return;
    for (;;) {
      const plan = await this.controller.planCreate(this.settings.remoteFolder, this.ignoreOptions());
      this.say("info", `Checks before creating the sync: ${plan.blockers.length} blocking, ${plan.warnings.length} to note.`);
      for (const b of plan.blockers) this.say("warn", `Blocking: ${b}`);
      for (const w of plan.warnings) this.say("info", `Note: ${w}`);
      this.afterRefresh();
      const answer = await confirmCreate(this.app, plan);
      if (answer === "cancel") return;
      if (answer === "mkdir") {
        const r = await this.controller.makeRemoteFolder(plan.remote);
        new Notice(`MEGA-Route: ${r.message}`, r.ok ? 4000 : 10000);
        if (!r.ok) return;
        continue;
      }
      const r = await this.controller.create(plan, this.ignoreOptions());
      new Notice(`MEGA-Route: ${r.message}`, r.ok ? 6000 : 12000);
      if (!r.ok) this.say("error", r.message);
      this.afterRefresh();
      return;
    }
  }

  async startServer(): Promise<void> {
    if (!this.controller) return;
    const r = await this.controller.startServer();
    this.lastFull = Date.now();
    new Notice(`MEGA-Route: ${r.message}`, r.ok ? 4000 : 10000);
    this.afterRefresh();
  }

  async stopServer(): Promise<void> {
    if (!this.controller) return;
    const ok = await confirm(
      this.app,
      "Stop MEGAcmd?",
      (el) => el.createEl("p", { text: "MEGAcmd's server stops, and with it every sync it runs on this computer, until it is started again. Transfers in progress resume then." }),
      "Stop MEGAcmd",
      true,
    );
    if (!ok) return;
    const r = await this.controller.stopServer();
    new Notice(`MEGA-Route: ${r.message}`, r.ok ? 4000 : 10000);
    this.afterRefresh();
  }

  /** Signs MEGAcmd in with what was typed in the settings. The values are passed on and dropped; the caller clears
   *  its fields. Messages never hold the password, the code or the full address. */
  async signIn(email: string, password: string, ui: SignInUi): Promise<SignInResult> {
    if (!this.controller) return { ok: false, kind: "not-found", message: "MEGAcmd was not found." };
    if (this.state.operation) {
      const message = `${this.state.operation} is in progress: wait for it to finish.`;
      new Notice(`MEGA-Route: ${message}`);
      return { ok: false, kind: "busy", message };
    }
    // MEGAcmd's login gives no step of its own: the time spent is shown, so a slow sign-in does not look stuck.
    const started = Date.now();
    let waitingForCode = false;
    const say = () => {
      const s = Math.round((Date.now() - started) / 1000);
      this.setOp(
        true,
        waitingForCode ? "Signing in: MEGAcmd is waiting for the one-time code." : `Signing in… ${s} s (MEGA is checking your password, then MEGAcmd loads your account's file list)`,
        undefined,
        waitingForCode ? "signing in: code?" : `signing in ${s} s`,
      );
    };
    say();
    const timer = window.setInterval(say, 1000);
    try {
      const r = await this.controller.signIn(email, password, {
        ...ui,
        askCode: (info) => {
          waitingForCode = true;
          say();
          return ui.askCode(info).finally(() => {
            waitingForCode = false;
          });
        },
      });
      this.lastFull = Date.now();
      this.say("info", `Sign-in took ${Date.now() - started} ms.`);
      new Notice(`MEGA-Route: ${r.message}`, r.ok ? 5000 : 12000);
      window.clearInterval(timer);
      this.setOp(false, r.message, r.ok);
      this.afterRefresh();
      return r;
    } finally {
      window.clearInterval(timer);
    }
  }

  /** Follows MEGAcmd's log file into the log, every second, until stopped (the settings tab's log pane). */
  followMegaCmdLog(): { where: string; stop: () => void } {
    const node = this.node;
    const path = this.paths?.log;
    if (!node || !path) return { where: "unknown (MEGAcmd was not found)", stop: () => undefined };
    const tail = new LogTail(node.fsp, path);
    let missingSaid = false;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const r = await tail.poll();
        if (r.missing && !missingSaid) {
          missingSaid = true;
          this.say("info", `MEGAcmd's log file is not there yet (${path}); it appears once MEGAcmd's server has run.`);
        }
        if (r.restarted) this.log.add("megacmd", "info", "(the log file was started again: MEGAcmd rotated it)");
        if (r.skipped) this.log.add("megacmd", "info", `(${r.skipped} bytes skipped: the log grew faster than the pane reads it)`);
        // Sign-in commands, codes and addresses are hidden before a line is kept (see secrets.ts).
        for (const line of r.lines.map(redactMegaCmdLine)) this.log.add("megacmd",/\bERR\b|error/i.test(line) ? "error" : /\bWARN/i.test(line) ? "warn" : "info", line);
      } catch (e) {
        this.say("warn", `Could not read MEGAcmd's log (${path}): ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        running = false;
      }
    };
    // poll() catches its own errors (said in the log); the interval only starts it.
    const id = window.setInterval(() => void poll(), 1000);
    return { where: path, stop: () => window.clearInterval(id) };
  }

  /** Writes the exclusions to .megaignore soon, when a sync of this vault exists (otherwise they are written when the
   *  sync is created). */
  exclusionsChanged(): void {
    this.countDirty = true;
    if (this.ignoreTimer !== null) window.clearTimeout(this.ignoreTimer);
    this.ignoreTimer = window.setTimeout(() => {
      this.ignoreTimer = null;
      if (!this.controller || !this.state.mine) return;
      this.controller.writeIgnore(this.ignoreOptions()).catch((e: unknown) => {
        this.say("error", `Could not write .megaignore: ${e instanceof Error ? e.message : String(e)}`);
      });
    }, 1500);
  }

  // ---------------------------------------------------------------- status bar, ribbon, menu

  applyVisibility(): void {
    this.statusEl?.toggle(this.settings.showStatusBar);
    this.ribbonEl?.toggle(this.settings.showRibbon);
  }

  private render(): void {
    const s = this.shown;
    const tip = `MEGA-Route: ${s.long}\nClick for the menu`;
    if (this.statusEl) {
      this.statusEl.empty();
      this.statusEl.createSpan({ cls: `mega-route-dot is-${s.level}` });
      this.statusEl.createSpan({ text: `MEGA: ${s.short}` });
      this.statusEl.setAttr("aria-label", tip);
      this.statusEl.setAttr("data-tooltip-position", "top");
    }
    if (this.ribbonEl) {
      for (const l of ["ok", "busy", "paused", "attention", "error", "off"]) this.ribbonEl.removeClass(`is-${l}`);
      this.ribbonEl.addClass(`is-${s.level}`);
      this.ribbonEl.setAttr("aria-label", tip);
      this.ribbonEl.style.setProperty("--mega-route-progress", String(s.progress ?? 0));
      this.ribbonEl.toggleClass("has-progress", s.progress !== null);
    }
  }

  /** The menu of the ribbon icon and the status bar. */
  menu(e: MouseEvent): void {
    const m = new Menu();
    const st = this.state;
    m.addItem((i) => i.setTitle(`MEGA: ${this.shown.short}`).setIcon("cloud").setDisabled(true));
    m.addItem((i) => i.setTitle("Refresh status").setIcon("refresh-cw").onClick(() => void this.refresh(true)));
    m.addSeparator();
    if (st.mine) {
      const paused = st.mine.runState === "Disabled" || st.mine.runState === "Suspended";
      if (paused) m.addItem((i) => i.setTitle("Resume the sync").setIcon("play").onClick(() => void this.change("resume")));
      else m.addItem((i) => i.setTitle("Pause the sync").setIcon("pause").onClick(() => void this.change("pause")));
    } else if (st.server === "running" && st.account.signedIn) {
      m.addItem((i) => i.setTitle("Create the sync…").setIcon("plus").onClick(() => void this.createSync()));
    }
    if (st.client.found) {
      if (st.server === "stopped") m.addItem((i) => i.setTitle("Start MEGAcmd").setIcon("play").onClick(() => void this.startServer()));
      else if (st.server === "running") m.addItem((i) => i.setTitle("Stop MEGAcmd…").setIcon("square").onClick(() => void this.stopServer()));
      if (st.server === "running" && st.account.signedIn === false) m.addItem((i) => i.setTitle("Sign in to MEGA…").setIcon("log-in").onClick(() => this.openSettings()));
    }
    m.addSeparator();
    m.addItem((i) => i.setTitle("Settings and logs").setIcon("settings").onClick(() => this.openSettings()));
    m.showAtMouseEvent(e);
  }

  openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    if (!setting) return;
    setting.open();
    setting.openTabById(this.manifest.id);
  }
}
