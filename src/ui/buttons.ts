// Buttons styled as destructive (sign out, remove the sync, a risky confirmation).

import { requireApiVersion } from "obsidian";
import type { ButtonComponent } from "obsidian";

/**
 * Styles `b` as destructive: Obsidian 1.13's setDestructive() (with setCta() for the primary action of a dialog);
 * before 1.13, the class "mod-warning" that the older setWarning() added, which those versions style.
 */
export function destructive(b: ButtonComponent, primary = false): ButtonComponent {
  if (requireApiVersion("1.13.0")) {
    b.setDestructive();
    if (primary) b.setCta();
  } else {
    b.buttonEl.addClass("mod-warning");
  }
  return b;
}
