// The live log pane in the settings tab: the plugin's own log and MEGAcmd's server log, as they grow.

import { Notice, setIcon } from "obsidian";
import { SYNC_LINE, formatLine, wrapClasses } from "../core/log.ts";
import type { LogBuffer, LogLine } from "../core/log.ts";
import type { Settings } from "../core/settings.ts";

export interface LogPaneHost {
  log: LogBuffer;
  settings: Settings;
  saveSettings(): Promise<void>;
  /** Starts following MEGAcmd's log file while the pane is open; returns where it is (or why not) and a stop function. */
  followMegaCmdLog(): { where: string; stop(): void };
  /** Wrap long lines (a per-device setting); off, the pane scrolls sideways. */
  getWrap(): boolean;
  setWrap(on: boolean): void;
}

const MAX_DOM_LINES = 2000;

export class LogPane {
  private readonly host: LogPaneHost;
  private box!: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private stopTail: (() => void) | null = null;

  constructor(host: LogPaneHost) {
    this.host = host;
  }

  private shows(l: LogLine): boolean {
    switch (this.host.settings.logFilter) {
      case "plugin":
        return l.source === "plugin";
      case "megacmd":
        return l.source === "megacmd";
      case "sync":
        return l.source === "plugin" ? l.level !== "debug" : SYNC_LINE.test(l.text);
      default:
        return true;
    }
  }

  mount(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "mega-route-logpane" });
    const bar = wrap.createDiv({ cls: "mega-route-logbar" });

    const select = bar.createEl("select", { cls: "dropdown" });
    const options: [Settings["logFilter"], string][] = [
      ["all", "Everything"],
      ["plugin", "MEGA-Route only"],
      ["megacmd", "MEGAcmd only"],
      ["sync", "Syncs and transfers"],
    ];
    for (const [value, label] of options) select.createEl("option", { value, text: label });
    select.value = this.host.settings.logFilter;
    select.setAttr("aria-label", "Lines to show");
    select.addEventListener("change", async () => {
      this.host.settings.logFilter = select.value as Settings["logFilter"];
      await this.host.saveSettings();
      this.renderAll();
    });

    const auto = bar.createEl("label", { cls: "mega-route-logauto" });
    const cb = auto.createEl("input", { type: "checkbox" });
    cb.checked = this.host.settings.logAutoscroll;
    auto.appendText(" Follow new lines");
    cb.addEventListener("change", async () => {
      this.host.settings.logAutoscroll = cb.checked;
      await this.host.saveSettings();
      if (cb.checked) this.scrollToEnd();
    });

    const wrapLabel = bar.createEl("label", { cls: "mega-route-logauto" });
    const wrapBox = wrapLabel.createEl("input", { type: "checkbox" });
    wrapBox.checked = this.host.getWrap();
    wrapLabel.appendText(" Wrap lines");
    wrapBox.addEventListener("change", () => {
      this.host.setWrap(wrapBox.checked);
      this.applyWrap();
      this.scrollToEnd();
    });

    const copy = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Copy the lines shown" } });
    setIcon(copy, "copy");
    copy.addEventListener("click", async () => {
      const text = this.host.log.all().filter((l) => this.shows(l)).map((l) => formatLine(l)).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        new Notice("MEGA-Route: log copied. Check it for addresses and paths before sharing it.");
      } catch (e) {
        new Notice(`MEGA-Route: could not copy the log (${e instanceof Error ? e.message : String(e)}).`);
      }
    });

    const clear = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Clear the pane (the files are not changed)" } });
    setIcon(clear, "eraser");
    clear.addEventListener("click", () => {
      this.host.log.clear();
      this.renderAll();
    });

    this.box = wrap.createDiv({ cls: "mega-route-log", attr: { tabindex: "0", role: "log", "aria-live": "off" } });
    this.applyWrap();
    const tail = this.host.followMegaCmdLog();
    this.stopTail = tail.stop;
    wrap.createDiv({ cls: "mega-route-logsource", text: `MEGAcmd's log: ${tail.where}` });

    this.renderAll();
    this.unsubscribe = this.host.log.subscribe((added) => this.append(added));
  }

  private applyWrap(): void {
    const c = wrapClasses(this.host.getWrap());
    this.box.removeClass(c.remove);
    this.box.addClass(c.add);
  }

  private renderAll(): void {
    this.box.empty();
    const lines = this.host.log.all().filter((l) => this.shows(l));
    for (const l of lines.slice(-MAX_DOM_LINES)) this.lineEl(l);
    if (!lines.length) this.box.createDiv({ cls: "mega-route-logempty", text: "No log lines yet." });
    this.scrollToEnd(true);
  }

  private lineEl(l: LogLine): void {
    const div = this.box.createDiv({ cls: `mega-route-logline is-${l.source} is-${l.level}`, text: formatLine(l) });
    div.dataset.t = String(l.t);
  }

  private append(added: LogLine[]): void {
    const shown = added.filter((l) => this.shows(l));
    if (!shown.length) return;
    const empty = this.box.querySelector(".mega-route-logempty");
    if (empty) empty.remove();
    for (const l of shown) this.lineEl(l);
    while (this.box.childElementCount > MAX_DOM_LINES) this.box.firstElementChild?.remove();
    this.scrollToEnd();
  }

  private scrollToEnd(force = false): void {
    if (force || this.host.settings.logAutoscroll) this.box.scrollTop = this.box.scrollHeight;
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopTail?.();
    this.stopTail = null;
  }
}
