// The settings tab: MEGAcmd (setup), the sync, exclusions, status bar and ribbon, the live log pane, and the 2.x data.

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MegaRoutePlugin from "../main.ts";
import { buildBlock } from "../core/megaignore.ts";
import { checkRemoteFolder } from "../core/paths.ts";
import { controls, describe } from "../core/status.ts";
import { LogPane } from "./logPane.ts";

const LINKS = {
  install: "https://mega.io/cmd",
  guide: "https://github.com/meganz/MEGAcmd/blob/master/UserGuide.md",
  megaignore: "https://help.mega.io/installs-apps/desktop/megaignore",
  docs: "https://github.com/Gameboard-dev/mega-route#readme",
};

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

export class MobileSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: MegaRoutePlugin) {
    super(app, plugin);
  }
  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("p", {
      text: "MEGA-Route works only in Obsidian's desktop app: it runs MEGA's command-line tool MEGAcmd, which phones and tablets cannot run. Sync this vault on a phone with MEGA's own mobile app instead.",
    });
  }
}

export class MegaRouteSettingTab extends PluginSettingTab {
  private readonly plugin: MegaRoutePlugin;
  private pane: LogPane | null = null;
  private statusBox: HTMLElement | null = null;
  private syncBox: HTMLElement | null = null;
  private off: (() => void) | null = null;

  constructor(app: App, plugin: MegaRoutePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const c = this.containerEl;
    this.hide();
    c.empty();
    c.addClass("mega-route-settings");
    c.removeClass("mega-route-contents-layout");
    const p = this.plugin;
    // The contents column comes first in the tab; it is filled once every section is drawn (end of display()).
    const nav = c.createEl("nav", { cls: "mega-route-contents" });

    const intro = c.createEl("p", { cls: "setting-item-description" });
    intro.appendText("MEGA-Route keeps this vault in a two-way sync with a folder on MEGA. The sync itself is run by MEGA's command-line tool MEGAcmd, a separate program you install; this plugin sets it up and shows how it is doing. ");
    link(intro, "Documentation", LINKS.docs);
    intro.appendText(".");

    // ------------------------------------------------------------ MEGAcmd
    new Setting(c).setName("MEGAcmd").setHeading();
    this.statusBox = c.createDiv({ cls: "mega-route-statusbox" });
    this.renderStatus();
    this.buildSignIn(c);

    new Setting(c)
      .setName("MEGAcmd's folder (this device)")
      .setDesc(`Where MEGAcmd is installed: its folder, or its client program. Leave empty for the usual place (${p.sys ? (p.sys.os === "windows" ? "%LOCALAPPDATA%\\MEGAcmd" : p.sys.os === "macos" ? "/Applications/MEGAcmd.app" : "/usr/bin") : "per system"}). Kept on this device only, never in the vault.`)
      .addText((t) =>
        t
          .setPlaceholder("default")
          .setValue(p.device.clientPath)
          .onChange((v) => {
            p.device.clientPath = v.trim();
            p.saveDevice();
          }),
      )
      .addButton((b) =>
        b.setButtonText("Check").onClick(async () => {
          await p.setupController();
          await p.refresh(true);
          new Notice(p.state.client.found ? `MEGA-Route: MEGAcmd found at ${p.state.client.path}.` : `MEGA-Route: ${p.state.client.reason ?? "MEGAcmd not found."}`, 8000);
          this.display();
        }),
      );

    new Setting(c)
      .setName("Start MEGAcmd with Obsidian (this device)")
      .setDesc("When Obsidian starts, start MEGAcmd's server if it is not running, which resumes the syncs it has. Off: MEGAcmd runs only when you start it (here, from the menu, or yourself).")
      .addToggle((t) =>
        t.setValue(p.device.startServerOnLoad).onChange((v) => {
          p.device.startServerOnLoad = v;
          p.saveDevice();
        }),
      );

    new Setting(c)
      .setName("Status checks while idle (this device)")
      .setDesc("Seconds between checks while the sync is idle and Obsidian has the focus (10 to 600). While the sync works: every 5 s. While Obsidian is in the background and the sync is idle: none.")
      .addText((t) =>
        t.setValue(String(p.device.idlePollSeconds)).onChange((v) => {
          const n = Number(v);
          if (Number.isFinite(n)) {
            p.device.idlePollSeconds = Math.min(600, Math.max(10, Math.round(n)));
            p.saveDevice();
          }
        }),
      );

    // ------------------------------------------------------------ the sync
    new Setting(c).setName("The sync").setHeading();
    const remote = new Setting(c)
      .setName("MEGA folder")
      .setDesc("The folder on MEGA that this vault syncs with, from the top of your Cloud Drive, such as /RAG. Used when the sync is created; changing it later does not move an existing sync.")
      .addText((t) =>
        t.setValue(p.settings.remoteFolder).onChange(async (v) => {
          p.settings.remoteFolder = v.trim();
          await p.saveSettings();
          const ok = checkRemoteFolder(p.settings.remoteFolder);
          remote.descEl.toggleClass("mod-warning", !ok.ok);
          remoteProblem.setText(ok.ok ? "" : ok.reason);
        }),
      );
    const remoteProblem = remote.descEl.createDiv({ cls: "mega-route-problem" });
    const rc = checkRemoteFolder(p.settings.remoteFolder);
    if (!rc.ok) remoteProblem.setText(rc.reason);

    this.syncBox = c.createDiv({ cls: "mega-route-syncbox" });
    this.renderSync();

    // ------------------------------------------------------------ exclusions
    new Setting(c).setName("Exclusions").setHeading();
    const ex = c.createEl("p", { cls: "setting-item-description" });
    ex.appendText("Written as MEGA's own rules into the file .megaignore at the top of the vault, inside a block marked MEGA-Route; the rest of that file is left as it is. Both MEGAcmd and the MEGA desktop app read it. ");
    link(ex, "MEGA's rules", LINKS.megaignore);
    ex.appendText(". Patterns: relative to the vault's top; * for any characters within one name, ** across folders, ? for one character, folder/** for a folder and everything in it.");

    const preview = c.createEl("pre", { cls: "mega-route-pre" });
    // Only patterns that cannot be written are listed, in the error colour; every other pattern is written as a MEGA
    // rule with exactly its meaning (megaignore.ts), so needs no comment.
    const problems = c.createDiv({ cls: "mega-route-problem" });
    const help = c.createDiv({
      cls: "setting-item-description mega-route-help",
      text: "A pattern with * or ? becomes a MEGA rule of the form -pr:… (a regular expression over the whole path), so that * stays within one name as you wrote it.",
    });
    const showPreview = () => {
      try {
        const b = buildBlock(p.ignoreOptions());
        preview.setText(b.rules.join("\n"));
        problems.setText(b.problems.map((x) => `Not written: "${x.pattern}" ${x.reason}.`).join("\n"));
        help.toggle(b.rules.some((r) => /^[-+][a-z]*r:/.test(r)));
      } catch (e) {
        problems.setText(e instanceof Error ? e.message : String(e));
      }
    };

    new Setting(c)
      .setName("Leave out")
      .setDesc("One pattern per line, e.g. .git/** or LaTeX/compiled/*.log.")
      .addTextArea((t) => {
        t.inputEl.rows = 6;
        t.setValue(p.settings.excludePatterns).onChange(async (v) => {
          p.settings.excludePatterns = v;
          await p.saveSettings();
          showPreview();
          p.exclusionsChanged();
        });
      });
    new Setting(c)
      .setName("Sync even so")
      .setDesc("Patterns of paths to sync even when a rule above, or in the rest of .megaignore, leaves them out.")
      .addTextArea((t) => {
        t.inputEl.rows = 3;
        t.setValue(p.settings.includePatterns).onChange(async (v) => {
          p.settings.includePatterns = v;
          await p.saveSettings();
          showPreview();
          p.exclusionsChanged();
        });
      });
    new Setting(c)
      .setName("Sync Obsidian's settings folder")
      .setDesc(`Sync ${this.app.vault.configDir} (settings, plugins, themes) with the vault. MEGA's default rules leave out every name starting with a dot; this brings the folder back. The window layout (workspace files) and this plugin's own folder are always left out.`)
      .addToggle((t) =>
        t.setValue(p.settings.syncConfigFolder).onChange(async (v) => {
          p.settings.syncConfigFolder = v;
          await p.saveSettings();
          showPreview();
          p.exclusionsChanged();
        }),
      );
    new Setting(c)
      .setName("MEGA-Route's block in .megaignore")
      .setDesc("The rules below are written when the sync is created, and again whenever these settings change while it exists. The last rule that matches a path decides, so the fixed rules at the end always apply.")
      .addButton((b) =>
        b.setButtonText("Write to .megaignore now").onClick(async () => {
          if (!p.controller) return;
          try {
            const r = await p.controller.writeIgnore(p.ignoreOptions());
            new Notice(r.written ? "MEGA-Route: .megaignore updated." : "MEGA-Route: .megaignore was already up to date.");
          } catch (e) {
            new Notice(`MEGA-Route: could not write .megaignore: ${e instanceof Error ? e.message : String(e)}`, 10000);
          }
        }),
      );
    c.appendChild(preview);
    c.appendChild(problems);
    c.appendChild(help);
    showPreview();

    // ------------------------------------------------------------ status bar and ribbon
    new Setting(c).setName("Status bar and ribbon").setHeading();
    new Setting(c).setName("Show in the status bar").addToggle((t) =>
      t.setValue(p.settings.showStatusBar).onChange(async (v) => {
        p.settings.showStatusBar = v;
        await p.saveSettings();
        p.applyVisibility();
      }),
    );
    new Setting(c).setName("Show the ribbon icon").addToggle((t) =>
      t.setValue(p.settings.showRibbon).onChange(async (v) => {
        p.settings.showRibbon = v;
        await p.saveSettings();
        p.applyVisibility();
      }),
    );

    // ------------------------------------------------------------ logs
    new Setting(c).setName("Logs").setHeading();
    c.createEl("p", {
      cls: "setting-item-description",
      text: "MEGA-Route's own log, and MEGAcmd's server log as it grows, while this tab is open. MEGAcmd's log level is MEGAcmd's own setting (its log command); the pane shows whatever MEGAcmd writes.",
    });
    this.pane = new LogPane({
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
    this.pane.mount(c);

    this.contents(c, nav);

    this.off = p.onStateChange(() => {
      this.renderStatus();
      this.renderSync();
      this.updateSignIn();
    });
    // MEGAcmd may have been installed since Obsidian started: look again before checking.
    void (async () => {
      if (!p.state.client.found) await p.setupController();
      await p.refresh(true);
    })();
  }

  private renderStatus(): void {
    const box = this.statusBox;
    if (!box) return;
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

  /**
   * The sign-in form, built once per display (a status refresh must not wipe what is being typed). The email,
   * password and one-time code live only in these fields and in the call that passes them to MEGAcmd; the fields are
   * emptied when the attempt ends (the password at once), and nothing is saved.
   *
   * The one-time code field is always there and optional. A code typed before Sign in is given to MEGAcmd only if
   * MEGAcmd asks for one (written to its input, never on a command line), and simply unused if the account has no
   * two-factor authentication. Left empty, the same field is highlighted and focused when MEGAcmd asks.
   */
  private buildSignIn(parent: HTMLElement): void {
    const p = this.plugin;
    const box = parent.createDiv({ cls: "mega-route-signin" });
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
      b.setButtonText("Sign out…").setWarning().onClick(() => void p.signOut());
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
        this.updateSignIn();
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

    this.updateSignIn = () => {
      const s = p.state;
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
      const ctl = controls(s).signIn;
      const off = !ctl.enabled && !busy;
      email.disabled = off || busy;
      password.disabled = off || busy;
      code.disabled = off || (busy && !pending);
      button.disabled = off || (busy && !pending);
      tip.setText(off && ctl.tip ? ctl.tip : "");
      const out = controls(s).signOut;
      if (outButton) (outButton as HTMLButtonElement).disabled = !out.enabled || busy;
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
    this.updateSignIn();
  }

  private updateSignIn: () => void = () => undefined;

  /**
   * The tab's contents: a link to every section heading, beside the sections and in view as they scroll where the
   * window is wide (styles.css), in a line above them where it is not. Filled after the sections are drawn, so every
   * heading is listed; clicking one scrolls to it. The same layout as the author's other plugins' settings tabs.
   */
  private contents(el: HTMLElement, nav: HTMLElement): void {
    if (!nav.isConnected) return; // drawn again meanwhile
    const heads = Array.from(el.querySelectorAll<HTMLElement>(".setting-item-heading"));
    if (heads.length < 3) {
      nav.remove();
      return;
    }
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
    el.addClass("mega-route-contents-layout");
  }

  private renderSync(): void {
    const box = this.syncBox;
    if (!box) return;
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
      set.addButton((b) => b.setButtonText("Remove…").setWarning().onClick(() => void p.change("remove")));
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

  hide(): void {
    this.pane?.unmount();
    this.pane = null;
    this.off?.();
    this.off = null;
  }
}
