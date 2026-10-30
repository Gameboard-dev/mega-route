// The settings tab: MEGAcmd (setup), the sync, exclusions, status bar and ribbon, the live log pane.
//
// The tab is described once, as sections of rows (sections() below), and drawn two ways:
//   - Obsidian 1.13 and later: getSettingDefinitions(), Obsidian's declarative settings, so every row is found by
//     Obsidian's settings search. Plain settings are controls (read and written through getControlValue and
//     setControlValue); the live panels (MEGAcmd's state, the sign-in form, the sync, the .megaignore preview, the log
//     pane) are rows drawn by a render function, which returns its own clean-up.
//   - Earlier versions (the manifest's minAppVersion is 1.8.7): display() draws the same rows with Setting.

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinition, SettingDefinitionItem } from "obsidian";
import type MegaRoutePlugin from "../main.ts";
import { buildBlock } from "../core/megaignore.ts";
import { checkRemoteFolder } from "../core/paths.ts";
import { controls, describe } from "../core/status.ts";
import { destructive } from "./buttons.ts";
import { LogPane } from "./logPane.ts";

const LINKS = {
  install: "https://mega.io/cmd",
  guide: "https://github.com/meganz/MEGAcmd/blob/master/UserGuide.md",
  megaignore: "https://help.mega.io/installs-apps/desktop/megaignore",
  docs: "https://github.com/Gameboard-dev/mega-route#readme",
};

const MOBILE_TEXT =
  "MEGA-Route works only in Obsidian's desktop app: it runs MEGA's command-line tool MEGAcmd, which phones and tablets cannot run. Sync this vault on a phone with MEGA's own mobile app instead.";

function link(el: HTMLElement, text: string, href: string): void {
  el.createEl("a", { text, href, attr: { target: "_blank", rel: "noopener" } });
}

/**
 * Greys out a row's buttons and inputs when `tip` is set, and says why: on hover (on the row, since a disabled control
 * gets no hover events) and under the row's description.
 */
function greyOut(set: Setting, tip: string | null): void {
  if (!tip) return;
  set.controlEl.querySelectorAll("button, input, select, textarea").forEach((el) => ((el as HTMLButtonElement).disabled = true));
  set.settingEl.addClass("mega-route-disabled");
  set.settingEl.setAttr("aria-label", tip);
  set.descEl.createDiv({ cls: "mega-route-problem", text: tip });
}

/** A row turned into a panel that holds several rows of its own (the row's own name and description are replaced). */
function panel(s: Setting, cls: string): HTMLElement {
  const el = s.settingEl;
  el.empty();
  el.addClass("mega-route-panel", cls);
  return el;
}

/** A clean-up that runs once, whether Obsidian or hide() calls it first. */
function once(f: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    f();
  };
}

// ---------------------------------------------------------------- the rows

type Key = "clientPath" | "startServerOnLoad" | "idlePollSeconds" | "remoteFolder" | "excludePatterns" | "includePatterns" | "syncConfigFolder" | "showStatusBar" | "showRibbon";

type Control =
  | { type: "text"; key: Key; placeholder?: string; validate?: (v: string) => string | undefined }
  | { type: "textarea"; key: Key; rows: number }
  | { type: "toggle"; key: Key }
  | { type: "number"; key: Key; min: number; max: number };

type Row =
  | { name: string; desc?: string; aliases?: string[]; control: Control }
  | { name: string; desc?: string; aliases?: string[]; render: (s: Setting) => (() => void) | undefined };

interface Section {
  heading?: string;
  rows: Row[];
}

export class MobileSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: MegaRoutePlugin) {
    super(app, plugin);
  }
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{ name: "Desktop only", desc: MOBILE_TEXT }];
  }
  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("p", { text: MOBILE_TEXT });
  }
}

export class MegaRouteSettingTab extends PluginSettingTab {
  private readonly plugin: MegaRoutePlugin;
  /** The clean-ups of the rows drawn (subscriptions, the log pane), run by hide(). */
  private readonly cleanups = new Set<() => void>();
  /** Redraw the .megaignore preview (after the exclusions change). */
  private readonly previewListeners = new Set<() => void>();

  constructor(app: App, plugin: MegaRoutePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ------------------------------------------------------------ the values of the plain settings

  getControlValue(key: string): unknown {
    const p = this.plugin;
    switch (key as Key) {
      case "clientPath":
        return p.device.clientPath;
      case "startServerOnLoad":
        return p.device.startServerOnLoad;
      case "idlePollSeconds":
        return p.device.idlePollSeconds;
      case "remoteFolder":
        return p.settings.remoteFolder;
      case "excludePatterns":
        return p.settings.excludePatterns;
      case "includePatterns":
        return p.settings.includePatterns;
      case "syncConfigFolder":
        return p.settings.syncConfigFolder;
      case "showStatusBar":
        return p.settings.showStatusBar;
      case "showRibbon":
        return p.settings.showRibbon;
      default:
        return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const p = this.plugin;
    const text = typeof value === "string" ? value : String(value);
    const on = value === true;
    switch (key as Key) {
      case "clientPath":
        p.device.clientPath = text.trim();
        p.saveDevice();
        return;
      case "startServerOnLoad":
        p.device.startServerOnLoad = on;
        p.saveDevice();
        return;
      case "idlePollSeconds": {
        const n = Number(value);
        if (Number.isFinite(n)) {
          p.device.idlePollSeconds = Math.min(600, Math.max(10, Math.round(n)));
          p.saveDevice();
        }
        return;
      }
      case "remoteFolder":
        p.settings.remoteFolder = text.trim();
        await p.saveSettings();
        return;
      case "excludePatterns":
      case "includePatterns":
      case "syncConfigFolder":
        if (key === "excludePatterns") p.settings.excludePatterns = text;
        else if (key === "includePatterns") p.settings.includePatterns = text;
        else p.settings.syncConfigFolder = on;
        await p.saveSettings();
        this.previewListeners.forEach((f) => f());
        p.exclusionsChanged();
        return;
      case "showStatusBar":
      case "showRibbon":
        if (key === "showStatusBar") p.settings.showStatusBar = on;
        else p.settings.showRibbon = on;
        await p.saveSettings();
        p.applyVisibility();
        return;
    }
  }

  // ------------------------------------------------------------ the tab, described once

  private sections(): Section[] {
    const p = this.plugin;
    const usual = p.sys ? (p.sys.os === "windows" ? "%LOCALAPPDATA%\\MEGAcmd" : p.sys.os === "macos" ? "/Applications/MEGAcmd.app" : "/usr/bin") : "per system";
    return [
      {
        rows: [
          {
            name: "MEGA-Route",
            desc: "MEGA-Route keeps this vault in a two-way sync with a folder on MEGA. The sync itself is run by MEGA's command-line tool MEGAcmd, a separate program you install; this plugin sets it up and shows how it is doing.",
            aliases: ["documentation", "help"],
            render: (s) => {
              this.containerEl.addClass("mega-route-settings");
              s.descEl.appendText(" ");
              link(s.descEl, "Documentation", LINKS.docs);
              s.descEl.appendText(".");
              // The contents column is put in once every row is drawn.
              const t = window.setTimeout(() => this.contents(), 0);
              return () => window.clearTimeout(t);
            },
          },
        ],
      },
      {
        heading: "MEGAcmd",
        rows: [
          { name: "MEGAcmd's state", aliases: ["program", "server", "start", "stop", "account", "version", "install", "desktop app"], render: (s) => this.statusPanel(s) },
          { name: "Sign in to MEGA", aliases: ["login", "email", "password", "two-factor", "one-time code", "sign out", "logout"], render: (s) => this.signInPanel(s) },
          {
            name: "MEGAcmd's folder (this device)",
            desc: `Where MEGAcmd is installed: its folder, or its client program. Leave empty for the usual place (${usual}). Kept on this device only, never in the vault.`,
            aliases: ["path", "MegaClient", "mega-exec"],
            control: { type: "text", key: "clientPath", placeholder: "Default" },
          },
          {
            name: "Check for MEGAcmd",
            desc: "Looks for MEGAcmd at the folder above (or the usual place) and asks it for its state.",
            render: (s) => {
              s.addButton((b) =>
                b.setButtonText("Check").onClick(() => {
                  void (async () => {
                    await p.setupController();
                    await p.refresh(true);
                    new Notice(p.state.client.found ? `MEGA-Route: MEGAcmd found at ${p.state.client.path}.` : `MEGA-Route: ${p.state.client.reason ?? "MEGAcmd not found."}`, 8000);
                  })();
                }),
              );
              return undefined;
            },
          },
          {
            name: "Start MEGAcmd with Obsidian (this device)",
            desc: "When Obsidian starts, start MEGAcmd's server if it is not running, which resumes the syncs it has. Off: MEGAcmd runs only when you start it (here, from the menu, or yourself).",
            control: { type: "toggle", key: "startServerOnLoad" },
          },
          {
            name: "Status checks while idle (this device)",
            desc: "Seconds between checks while the sync is idle and Obsidian has the focus (10 to 600). While the sync works: every 5 s. While Obsidian is in the background and the sync is idle: none.",
            control: { type: "number", key: "idlePollSeconds", min: 10, max: 600 },
          },
        ],
      },
      {
        heading: "The sync",
        rows: [
          {
            name: "MEGA folder",
            desc: "The folder on MEGA that this vault syncs with, from the top of your cloud drive, such as /Notes. Used when the sync is created; changing it later does not move an existing sync.",
            aliases: ["remote folder", "cloud drive"],
            control: {
              type: "text",
              key: "remoteFolder",
              validate: (v) => {
                const r = checkRemoteFolder(v.trim());
                return r.ok ? undefined : r.reason;
              },
            },
          },
          { name: "Sync of this vault", aliases: ["create", "pause", "resume", "remove"], render: (s) => this.syncPanel(s) },
        ],
      },
      {
        heading: "Exclusions",
        rows: [
          {
            name: "How the exclusions are written",
            desc: "As MEGA's own rules, into the file .megaignore at the top of the vault, inside a block marked MEGA-Route; the rest of that file is left as it is. Both MEGAcmd and the MEGA desktop app read it. Patterns: relative to the vault's top; * for any characters within one name, ** across folders, ? for one character, folder/** for a folder and everything in it.",
            aliases: [".megaignore", "ignore", "exclude"],
            render: (s) => {
              s.descEl.appendText(" ");
              link(s.descEl, "MEGA's rules", LINKS.megaignore);
              s.descEl.appendText(".");
              return undefined;
            },
          },
          { name: "Leave out", desc: "One pattern per line, such as LaTeX/compiled/*.log or node_modules/**.", control: { type: "textarea", key: "excludePatterns", rows: 6 } },
          { name: "Sync even so", desc: "Patterns of paths to sync even when a rule above, or in the rest of .megaignore, leaves them out.", control: { type: "textarea", key: "includePatterns", rows: 3 } },
          {
            name: "Sync Obsidian's settings folder",
            desc: `Sync ${this.app.vault.configDir} (settings, plugins, themes) with the vault. MEGA's default rules leave out every name starting with a dot; this brings the folder back. The window layout (workspace files) and this plugin's own folder are always left out.`,
            control: { type: "toggle", key: "syncConfigFolder" },
          },
          { name: "MEGA-Route's block in .megaignore", aliases: ["rules", "write"], render: (s) => this.blockPanel(s) },
        ],
      },
      {
        heading: "Status bar and ribbon",
        rows: [
          { name: "Show in the status bar", control: { type: "toggle", key: "showStatusBar" } },
          { name: "Show the ribbon icon", control: { type: "toggle", key: "showRibbon" } },
        ],
      },
      {
        heading: "Logs",
        rows: [{ name: "Log", aliases: ["log", "MEGAcmd's log", "copy"], render: (s) => this.logPanel(s) }],
      },
    ];
  }

  /** Obsidian 1.13 and later: the same rows as declarative settings (found by the settings search). */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map((sec) => ({
      type: "group" as const,
      heading: sec.heading,
      items: sec.rows.map((r) => this.definition(r)),
    }));
  }

  private definition(r: Row): SettingDefinition {
    const base = { name: r.name, desc: r.desc, aliases: r.aliases };
    if ("render" in r) {
      const render = r.render;
      return { ...base, render: (s: Setting) => this.track(render(s)) };
    }
    const c = r.control;
    switch (c.type) {
      case "text":
        return { ...base, control: { type: "text", key: c.key, placeholder: c.placeholder, validate: c.validate } };
      case "textarea":
        return { ...base, control: { type: "textarea", key: c.key, rows: c.rows } };
      case "toggle":
        return { ...base, control: { type: "toggle", key: c.key } };
      case "number":
        return { ...base, control: { type: "number", key: c.key, min: c.min, max: c.max, validate: (v: number) => (v >= c.min && v <= c.max ? undefined : `Between ${c.min} and ${c.max}.`) } };
    }
  }

  /** Before Obsidian 1.13: the same rows, drawn with Setting. */
  display(): void {
    const c = this.containerEl;
    this.hide();
    c.empty();
    for (const sec of this.sections()) {
      if (sec.heading) new Setting(c).setName(sec.heading).setHeading();
      for (const r of sec.rows) {
        const s = new Setting(c).setName(r.name);
        if (r.desc) s.setDesc(r.desc);
        if ("render" in r) this.track(r.render(s));
        else this.drawControl(s, r.control);
      }
    }
  }

  private drawControl(s: Setting, c: Control): void {
    const value = this.getControlValue(c.key);
    const set = (v: unknown) => {
      this.setControlValue(c.key, v).catch((e: unknown) => new Notice(`MEGA-Route: could not save the setting: ${e instanceof Error ? e.message : String(e)}`));
    };
    switch (c.type) {
      case "toggle":
        s.addToggle((t) => t.setValue(value === true).onChange(set));
        return;
      case "textarea":
        s.addTextArea((t) => {
          t.inputEl.rows = c.rows;
          t.setValue(typeof value === "string" ? value : "").onChange(set);
        });
        return;
      case "number":
        s.addText((t) => t.setValue(String(value)).onChange(set));
        return;
      case "text": {
        const problem = s.descEl.createDiv({ cls: "mega-route-problem" });
        const check = (v: string): boolean => {
          const why = c.validate?.(v);
          problem.setText(why ?? "");
          return !why;
        };
        s.addText((t) => {
          if (c.placeholder) t.setPlaceholder(c.placeholder);
          t.setValue(typeof value === "string" ? value : "").onChange((v) => {
            if (check(v)) set(v);
          });
        });
        check(typeof value === "string" ? value : "");
        return;
      }
    }
  }

  private track(f: (() => void) | undefined): (() => void) | undefined {
    if (!f) return undefined;
    const g = once(() => {
      this.cleanups.delete(g);
      f();
    });
    this.cleanups.add(g);
    return g;
  }

  hide(): void {
    for (const f of [...this.cleanups]) f();
    this.cleanups.clear();
    super.hide();
  }

  // ------------------------------------------------------------ MEGAcmd's state

  private statusPanel(s: Setting): () => void {
    const p = this.plugin;
    const box = panel(s, "mega-route-statusbox");
    const draw = () => this.renderStatus(box);
    draw();
    const off = p.onStateChange(draw);
    // MEGAcmd may have been installed since Obsidian started: look again before checking.
    void (async () => {
      if (!p.state.client.found) await p.setupController();
      await p.refresh(true);
    })();
    return off;
  }

  private renderStatus(box: HTMLElement): void {
    const p = this.plugin;
    const s = p.state;
    box.empty();
    const row = (name: string, value: string, level: string, fill?: (el: HTMLElement) => void) => {
      const set = new Setting(box).setName(name);
      set.descEl.createSpan({ cls: `mega-route-dot is-${level}` });
      set.descEl.appendText(value);
      if (fill) fill(set.controlEl);
      return set;
    };
    row(
      "Program",
      s.client.found ? `Found: ${s.client.path}${s.client.version ? ` (version ${s.client.version})` : ""}` : `Not found${s.client.reason ? `: ${s.client.reason}` : ""}`,
      s.client.found ? "ok" : "error",
      (el) => {
        link(el, "Install MEGAcmd", LINKS.install);
        el.appendText(" · ");
        link(el, "User guide", LINKS.guide);
      },
    );
    const ctl = controls(s);
    const server = row(
      "Server",
      !s.client.found ? "MEGAcmd is not installed" : s.server === "running" ? "Running" : s.server === "stopped" ? "Not running: no sync runs" : "Unknown",
      !s.client.found ? "off" : s.server === "running" ? "ok" : s.server === "stopped" ? "off" : "attention",
    );
    if (s.server === "running") server.addButton((b) => b.setButtonText("Stop…").onClick(() => void p.stopServer()));
    else server.addButton((b) => b.setButtonText("Start MEGAcmd").setCta().onClick(() => void p.startServer()));
    greyOut(server, ctl.start.enabled || s.server === "running" ? null : ctl.start.tip);
    row(
      "Account",
      !s.client.found || s.server !== "running" ? "Unknown until MEGAcmd runs" : s.account.signedIn ? `Signed in${s.account.masked ? ` as ${s.account.masked}` : ""}` : s.account.signedIn === false ? "Not signed in: sign in below" : "Unknown",
      s.account.signedIn ? "ok" : s.account.signedIn === false ? "attention" : "off",
    );
    row(
      "MEGA desktop app",
      s.desktopApp === "running" ? "Running: make sure it does not sync or back up this vault's folder (or a folder containing it), see Troubleshooting" : s.desktopApp === "not-running" ? "Not running" : "Unknown",
      s.desktopApp === "running" ? "attention" : "off",
    );
    const shown = describe(s);
    const now = new Setting(box).setName("Now").setDesc(shown.long);
    now.addExtraButton((b) => b.setIcon("refresh-cw").setTooltip("Refresh").onClick(() => void p.refresh(true)));
    if (s.error) box.createDiv({ cls: "mega-route-problem", text: s.error });
  }

  // ------------------------------------------------------------ signing in and out

  /**
   * The sign-in form, built once per drawing (a status refresh must not wipe what is being typed). The email,
   * password and one-time code live only in these fields and in the call that passes them to MEGAcmd; the fields are
   * emptied when the attempt ends (the password at once), and nothing is saved.
   *
   * The one-time code field is always there and optional. A code typed before Sign in is given to MEGAcmd only if
   * MEGAcmd asks for one (written to its input, never on a command line), and simply unused if the account has no
   * two-factor authentication. Left empty, the same field is highlighted and focused when MEGAcmd asks.
   */
  private signInPanel(s: Setting): () => void {
    const p = this.plugin;
    const box = panel(s, "mega-route-signin");
    // The action running (a step with a spinner) or the last one's result, which stays until the next action.
    const opLine = box.createDiv({ cls: "mega-route-op", attr: { role: "status", "aria-live": "polite" } });
    const form = new Setting(box).setName("Sign in to MEGA").setDesc(
      "Your MEGA email and password are passed to MEGAcmd on this computer, which signs in and keeps its own session. The plugin does not store them or send them anywhere else.",
    );
    const fields = form.controlEl.createDiv({ cls: "mega-route-signin-fields" });
    const email = fields.createEl("input", { type: "email", cls: "mega-route-input", attr: { placeholder: "Email", autocomplete: "off", spellcheck: "false", "aria-label": "MEGA email" } });
    const password = fields.createEl("input", { type: "password", cls: "mega-route-input", attr: { placeholder: "Password", autocomplete: "off", "aria-label": "MEGA password" } });

    const codeRow = new Setting(box).setName("One-time code (only if two-factor authentication is on)");
    const codeDesc = codeRow.descEl.createDiv({ text: "The six-digit code from your authenticator app. Leave it empty if your account has no two-factor authentication, or type it when MEGAcmd asks." });
    const code = codeRow.controlEl.createEl("input", {
      type: "text",
      cls: "mega-route-input mega-route-code",
      attr: { inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", pattern: "[0-9 ]*", placeholder: "Optional: 6 digits", spellcheck: "false", "aria-label": "One-time code" },
    });
    const cancel = codeRow.controlEl.createEl("button", { text: "Cancel" });
    cancel.hide();
    const button = codeRow.controlEl.createEl("button", { text: "Sign in", cls: "mod-cta" });
    const tip = box.createDiv({ cls: "mega-route-problem" });

    // Signing out: only while MEGAcmd is signed in; a dialog says what happens first (main.ts signOut).
    const outRow = new Setting(box)
      .setName("Sign out of MEGA")
      .setDesc("Pauses the sync, cancels transfers in progress, then signs MEGAcmd out, which also removes its sync of this vault. Your files stay as they are.");
    let outButton: HTMLButtonElement | null = null;
    outRow.addButton((b) => {
      outButton = b.buttonEl;
      destructive(b.setButtonText("Sign out…")).onClick(() => void p.signOut());
    });

    let busy = false;
    let pending: ((v: string | null) => void) | null = null;
    const defaultDesc = codeDesc.getText();
    /** Gives the code typed (or null: cancelled) to the waiting sign-in, and empties the field. */
    const answer = (v: string | null) => {
      const f = pending;
      pending = null;
      code.value = "";
      codeRow.settingEl.removeClass("mega-route-attention");
      codeDesc.setText(defaultDesc);
      cancel.hide();
      button.setText(busy ? "Signing in…" : "Sign in");
      button.disabled = busy;
      f?.(v);
    };

    const update = () => {
      const st = p.state;
      const op = p.opStatus;
      opLine.empty();
      opLine.toggle(!!op);
      if (op) {
        opLine.toggleClass("is-running", op.running);
        opLine.toggleClass("is-ok", !op.running && op.ok === true);
        opLine.toggleClass("is-error", !op.running && op.ok === false);
        if (op.running) opLine.createSpan({ cls: "mega-route-spinner", attr: { "aria-hidden": "true" } });
        opLine.createSpan({ text: op.text });
      }
      const ctl = controls(st).signIn;
      const off = !ctl.enabled && !busy;
      email.disabled = off || busy;
      password.disabled = off || busy;
      code.disabled = off || (busy && !pending);
      button.disabled = off || (busy && !pending);
      tip.setText(off && ctl.tip ? ctl.tip : "");
      const out = controls(st).signOut;
      if (outButton) outButton.disabled = !out.enabled || busy;
      outRow.settingEl.toggleClass("mega-route-disabled", !out.enabled);
      if (!out.enabled && out.tip) outRow.settingEl.setAttr("aria-label", out.tip);
      else outRow.settingEl.removeAttribute("aria-label");
      // A disabled control gets no hover events, so the reason is put on the rows as well as shown under them.
      for (const row of [form.settingEl, codeRow.settingEl]) {
        if (off && ctl.tip) row.setAttr("aria-label", ctl.tip);
        else row.removeAttribute("aria-label");
        row.toggleClass("mega-route-disabled", off);
      }
    };

    const go = async () => {
      if (busy || button.disabled) return;
      busy = true;
      const e = email.value;
      const pw = password.value;
      const early = code.value;
      // Emptied at once: the values now live only in this call.
      password.value = "";
      code.value = "";
      button.disabled = true;
      button.setText("Signing in…");
      try {
        await p.signIn(e, pw, {
          code: early.trim() ? early : undefined,
          askCode: (info) =>
            new Promise<string | null>((resolve) => {
              pending = resolve;
              codeDesc.setText(
                info.retry
                  ? `That code was not accepted (wrong, or expired). Enter the next code from your authenticator app (try ${info.attempt} of ${info.of}); the password is not needed again.`
                  : "Enter the code from your authenticator app: MEGAcmd is waiting for it.",
              );
              codeRow.settingEl.addClass("mega-route-attention");
              cancel.show();
              button.setText("Send code");
              button.disabled = false;
              code.disabled = false;
              code.focus();
            }),
          done: () => answer(null),
        });
      } finally {
        busy = false;
        email.value = "";
        password.value = "";
        code.value = "";
        answer(null);
        update();
      }
    };
    const submit = () => {
      if (pending) answer(code.value);
      else void go();
    };
    button.addEventListener("click", submit);
    cancel.addEventListener("click", () => answer(null));
    for (const el of [email, password, code]) {
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") submit();
      });
    }

    update();
    const off = p.onStateChange(update);
    return () => {
      off();
      // A sign-in waiting for a code when the tab closes is cancelled.
      if (pending) answer(null);
    };
  }

  // ------------------------------------------------------------ the sync

  private syncPanel(s: Setting): () => void {
    const box = panel(s, "mega-route-syncbox");
    const draw = () => this.renderSync(box);
    draw();
    return this.plugin.onStateChange(draw);
  }

  private renderSync(box: HTMLElement): void {
    const p = this.plugin;
    const s = p.state;
    box.empty();
    const m = s.mine;
    if (m) {
      const shown = describe(s);
      const set = new Setting(box).setName(`Sync ${m.id}`);
      set.descEl.createSpan({ cls: `mega-route-dot is-${shown.level}` });
      set.descEl.appendText(`${m.localPath} ↔ ${m.remotePath}`);
      set.descEl.createDiv({ text: `State ${m.runState}, status ${m.status}${m.error && m.error !== "NO" ? `, ${m.error}` : ""}. On MEGA: ${m.files ?? "?"} files, ${m.dirs ?? "?"} folders, ${m.size}.` });
      const paused = m.runState === "Disabled" || m.runState === "Suspended";
      if (paused) set.addButton((b) => b.setButtonText("Resume").setCta().onClick(() => void p.change("resume")));
      else set.addButton((b) => b.setButtonText("Pause").onClick(() => void p.change("pause")));
      set.addButton((b) => destructive(b.setButtonText("Remove…")).onClick(() => void p.change("remove")));
      const ctl = controls(s).change;
      greyOut(set, ctl.enabled ? null : ctl.tip);
    } else {
      const ctl = controls(s).create;
      const set = new Setting(box)
        .setName("No sync of this vault yet")
        .setDesc("Checks MEGAcmd, the MEGA folder and the MEGA desktop app, shows what will happen, and creates the sync only when you confirm.");
      set.addButton((b) => {
        b.setButtonText("Check and create…").onClick(() => void p.createSync());
        if (ctl.enabled) b.setCta();
      });
      greyOut(set, ctl.enabled ? null : ctl.tip);
    }
    const others = s.syncs.filter((r) => r !== m);
    if (others.length) {
      box.createDiv({ cls: "setting-item-description", text: `MEGAcmd's other syncs on this computer: ${others.map((r) => `${r.localPath} ↔ ${r.remotePath} (${r.runState}, ${r.status})`).join("; ")}.` });
    }
  }

  // ------------------------------------------------------------ the plugin's block in .megaignore

  private blockPanel(s: Setting): () => void {
    const p = this.plugin;
    const box = panel(s, "mega-route-blockbox");
    new Setting(box)
      .setName("MEGA-Route's block in .megaignore")
      .setDesc("The rules below are written when the sync is created, and again whenever these settings change while it exists. The last rule that matches a path decides, so the fixed rules at the end always apply.")
      .addButton((b) =>
        b.setButtonText("Write to .megaignore now").onClick(() => {
          const c = p.controller;
          if (!c) return;
          c.writeIgnore(p.ignoreOptions()).then(
            (r) => new Notice(r.written ? "MEGA-Route: .megaignore updated." : "MEGA-Route: .megaignore was already up to date."),
            (e: unknown) => new Notice(`MEGA-Route: could not write .megaignore: ${e instanceof Error ? e.message : String(e)}`, 10000),
          );
        }),
      );
    const preview = box.createEl("pre", { cls: "mega-route-pre" });
    // Only patterns that cannot be written are listed, in the error colour; every other pattern is written as a MEGA
    // rule with exactly its meaning (megaignore.ts), so needs no comment.
    const problems = box.createDiv({ cls: "mega-route-problem" });
    const help = box.createDiv({
      cls: "setting-item-description mega-route-help",
      text: "A pattern with * or ? becomes a MEGA rule of the form -pr:… (a regular expression over the whole path), so that * stays within one name as you wrote it.",
    });
    const show = () => {
      try {
        const b = buildBlock(p.ignoreOptions());
        preview.setText(b.rules.join("\n"));
        problems.setText(b.problems.map((x) => `Not written: "${x.pattern}" ${x.reason}.`).join("\n"));
        help.toggle(b.rules.some((r) => /^[-+][a-z]*r:/.test(r)));
      } catch (e) {
        problems.setText(e instanceof Error ? e.message : String(e));
      }
    };
    show();
    this.previewListeners.add(show);
    return () => this.previewListeners.delete(show);
  }

  // ------------------------------------------------------------ logs

  private logPanel(s: Setting): () => void {
    const p = this.plugin;
    const box = panel(s, "mega-route-logbox");
    box.createEl("p", {
      cls: "setting-item-description",
      text: "MEGA-Route's own log, and MEGAcmd's server log as it grows, while this tab is open. MEGAcmd's log level is MEGAcmd's own setting (its log command); the pane shows whatever MEGAcmd writes.",
    });
    const pane = new LogPane({
      log: p.log,
      settings: p.settings,
      saveSettings: () => p.saveSettings(),
      followMegaCmdLog: () => p.followMegaCmdLog(),
      getWrap: () => p.device.logWrap,
      setWrap: (on) => {
        p.device.logWrap = on;
        p.saveDevice();
      },
    });
    pane.mount(box);
    return () => pane.unmount();
  }

  // ------------------------------------------------------------ the contents column

  /**
   * The tab's contents: a link to every section heading, beside the sections and in view as they scroll where the
   * window is wide (styles.css), in a line above them where it is not. Put in after the rows are drawn, so every
   * heading is listed; clicking one scrolls to it. The same layout as the author's other plugins' settings tabs.
   */
  private contents(): void {
    const el = this.containerEl;
    el.querySelector(":scope > .mega-route-contents")?.remove();
    const heads = Array.from(el.querySelectorAll<HTMLElement>(".setting-item-heading"));
    if (heads.length < 3) {
      el.removeClass("mega-route-contents-layout");
      return;
    }
    const nav = createEl("nav", { cls: "mega-route-contents" });
    nav.createDiv({ cls: "mega-route-contents-title", text: "Contents" });
    const links = nav.createDiv({ cls: "mega-route-contents-links" });
    heads.forEach((head, i) => {
      const a = links.createEl("a", { text: head.querySelector(".setting-item-name")?.textContent ?? "", href: "#" });
      a.addEventListener("click", (e) => {
        e.preventDefault();
        head.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      if (i + 1 < heads.length) links.createSpan({ cls: "mega-route-contents-sep", text: " · " });
    });
    el.prepend(nav);
    el.addClass("mega-route-contents-layout");
  }
}
