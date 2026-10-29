// Confirmation dialogs. Closing a dialog (Esc, the ×, a click outside) always counts as Cancel.

import { App, Modal, Setting } from "obsidian";
import type { CreatePlan } from "../core/controller.ts";

class Confirm extends Modal {
  private done = false;
  private readonly heading: string;
  private readonly body: (el: HTMLElement) => void;
  private readonly yes: string;
  private readonly risky: boolean;
  private readonly resolve: (ok: boolean) => void;

  constructor(app: App, heading: string, body: (el: HTMLElement) => void, yes: string, risky: boolean, resolve: (ok: boolean) => void) {
    super(app);
    this.heading = heading;
    this.body = body;
    this.yes = yes;
    this.risky = risky;
    this.resolve = resolve;
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    this.modalEl.addClass("mega-route-modal");
    this.body(this.contentEl);
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(false)))
      .addButton((b) => {
        b.setButtonText(this.yes).onClick(() => this.finish(true));
        if (this.risky) b.setWarning();
        else b.setCta();
      });
  }

  private finish(ok: boolean): void {
    if (this.done) return;
    this.done = true;
    this.resolve(ok);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.done) {
      this.done = true;
      this.resolve(false);
    }
  }
}

export function confirm(app: App, heading: string, body: (el: HTMLElement) => void, yes: string, risky = false): Promise<boolean> {
  return new Promise((resolve) => new Confirm(app, heading, body, yes, risky, resolve).open());
}

/** The checks before the sync is created, and what it will do. Resolves "create", "mkdir" or "cancel". */
export function confirmCreate(app: App, plan: CreatePlan): Promise<"create" | "mkdir" | "cancel"> {
  return new Promise((resolve) => {
    let answered = false;
    const m = new (class extends Modal {
      onOpen(): void {
        this.titleEl.setText(plan.ok ? "Create the sync?" : "The sync cannot be created yet");
        this.modalEl.addClass("mega-route-modal");
        const c = this.contentEl;
        const table = c.createEl("table", { cls: "mega-route-plan" });
        const row = (k: string, v: string) => {
          const tr = table.createEl("tr");
          tr.createEl("th", { text: k });
          tr.createEl("td", { text: v });
        };
        row("This vault", plan.local);
        row("MEGA folder", plan.remote);
        row("Kind", "Two-way: additions, changes and deletions on either side are made on the other.");
        if (plan.remoteExists) row("In the MEGA folder", plan.remoteCount ? `${plan.remoteCount} item${plan.remoteCount === 1 ? "" : "s"} at the top${plan.remoteItems.length ? `: ${plan.remoteItems.slice(0, 12).join(", ")}${plan.remoteCount > 12 ? ", …" : ""}` : ""}` : "nothing (empty)");
        if (plan.blockers.length) {
          c.createEl("h4", { text: "Blocking" });
          const ul = c.createEl("ul", { cls: "mega-route-blockers" });
          for (const b of plan.blockers) ul.createEl("li", { text: b });
        }
        if (plan.warnings.length) {
          c.createEl("h4", { text: "Before you confirm" });
          const ul = c.createEl("ul", { cls: "mega-route-warnings" });
          for (const w of plan.warnings) ul.createEl("li", { text: w });
        }
        if (plan.ok) {
          c.createEl("p", {
            text: "Deleted files are not lost at once: MEGA keeps those deleted in the vault in its Rubbish Bin (SyncDebris), and those deleted on MEGA in a hidden debris folder at the vault's top.",
          });
          const d = c.createEl("details");
          d.createEl("summary", { text: "The .megaignore file that will be written first" });
          d.createEl("pre", { cls: "mega-route-pre", text: plan.ignoreText });
        }
        const s = new Setting(c);
        s.addButton((b) => b.setButtonText("Cancel").onClick(() => this.answer("cancel")));
        const missing = plan.blockers.some((x) => x.includes("does not exist on MEGA"));
        if (missing && plan.blockers.length === 1) {
          s.addButton((b) => b.setButtonText(`Create ${plan.remote} on MEGA`).onClick(() => this.answer("mkdir")));
        }
        if (plan.ok) s.addButton((b) => b.setButtonText("Create the sync").setCta().onClick(() => this.answer("create")));
      }
      answer(a: "create" | "mkdir" | "cancel"): void {
        if (answered) return;
        answered = true;
        resolve(a);
        this.close();
      }
      onClose(): void {
        this.contentEl.empty();
        if (!answered) {
          answered = true;
          resolve("cancel");
        }
      }
    })(app);
    m.open();
  });
}
