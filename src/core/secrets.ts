// Signing in: checks on the email, password and two-factor code before they are passed to MEGAcmd, and redaction of
// them (and of MEGAcmd's own sign-in lines) from everything the plugin logs or shows.
//
// How MEGAcmd's Windows client passes arguments on (src/client/megacmdclient.cpp, src/megacmdcommonutils.cpp
// getlistOfWords): it joins them into one line, wrapping in "…" only those that hold a space and never escaping a
// quotation mark; its server splits that line again, reads a word that starts with " or ' as quoted (dropping the
// quote), and reads a word starting with - as an option. So a password holding ", one starting with -, or one starting
// with ' and holding no space would not reach MEGA as typed; those are refused with a message, never altered.

import { maskEmail } from "./parse.ts";

export type Checked = { ok: true; value: string } | { ok: false; reason: string };

function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

/** A MEGA account's email address. The messages never repeat what was typed. */
export function checkEmail(input: unknown): Checked {
  if (typeof input !== "string") return { ok: false, reason: "The email address is missing." };
  // Checked before trimming: trim() would also take away line and paragraph separators.
  if (hasControl(input)) return { ok: false, reason: "The email address contains a control character (such as a line break)." };
  const s = input.trim();
  if (!s) return { ok: false, reason: "Type the email address of your MEGA account." };
  if (s.length > 254) return { ok: false, reason: "The email address is longer than 254 characters." };
  if (hasControl(s)) return { ok: false, reason: "The email address contains a control character (such as a line break)." };
  if (/[\s"'\\]/.test(s)) return { ok: false, reason: "The email address contains a space, a quotation mark or a backslash." };
  if (s.startsWith("-")) return { ok: false, reason: "The email address starts with -, which MEGAcmd would read as an option." };
  if (!/^[A-Za-z0-9._%+!#$&*/=?^`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(s)) return { ok: false, reason: "That is not an email address MEGA would accept." };
  return { ok: true, value: s };
}

/** A password MEGAcmd's client can pass on unchanged (see the note at the top). */
export function checkPassword(input: unknown): Checked {
  if (typeof input !== "string" || input.length === 0) return { ok: false, reason: "Type your MEGA password." };
  if (input.length > 1024) return { ok: false, reason: "The password is longer than 1024 characters." };
  if (hasControl(input)) return { ok: false, reason: "The password contains a control character (such as a line break or a tab), which MEGAcmd cannot be given from here." };
  const cannot = "MEGAcmd's command-line client cannot be given it unchanged; sign in once in MEGAcmd itself (open MEGAcmd from your Start menu or a terminal, and type: login followed by your email), then press Refresh.";
  if (input.includes('"')) return { ok: false, reason: `The password contains a quotation mark ("). ${cannot}` };
  if (input.startsWith("-")) return { ok: false, reason: `The password starts with -. ${cannot}` };
  if (input.startsWith("'") && !/\s/.test(input)) return { ok: false, reason: `The password starts with ' (and has no space). ${cannot}` };
  return { ok: true, value: input };
}

/** A two-factor code from an authenticator app: six digits. */
export function checkCode(input: unknown): Checked {
  if (typeof input !== "string") return { ok: false, reason: "Type the six-digit code from your authenticator app." };
  const s = input.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(s)) return { ok: false, reason: "The two-factor code is six digits, from your authenticator app." };
  return { ok: true, value: s };
}

const REDACTED = "[redacted]";

/** `text` with every given secret replaced, and every email address masked. */
export function redactText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  // Longest first, so a secret that contains another is replaced whole.
  for (const s of [...secrets].filter((x) => x && x.length > 0).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(REDACTED);
  }
  return maskEmailsIn(out);
}

const EMAIL = /[A-Za-z0-9._%+!#$&*/=?^`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

export function maskEmailsIn(text: string): string {
  return text.replace(EMAIL, (m) => maskEmail(m));
}

/**
 * A line of MEGAcmd's server log, fit to show. MEGAcmd already writes sign-in commands as "login <REDACTED>" (unless
 * MEGACMD_DO_NOT_REDACT_LINES is set where its server was started), but at its `verbose` level it writes the two-factor
 * code ("Using confirmation pin: …"), and it writes the account's address at `debug`. This hides all of those, and
 * any --password=, --auth-code= or --auth-key= value.
 */
export function redactMegaCmdLine(line: string): string {
  let out = line;
  // "login <email> <password>", "login <session>", "login <link>"; "passwd …", "confirm …", "confirmcancel …".
  out = out.replace(/\b(X?login\s+)(?!<REDACTED>)(\S+@\S+|[A-Za-z0-9_-]{30,}|https?:\S+).*$/i, `$1${REDACTED}`);
  out = out.replace(/\b(X?(?:passwd|confirmcancel|confirm)\s+)(?!<REDACTED>)\S.*$/i, `$1${REDACTED}`);
  out = out.replace(/(--password=)("[^"]*"|'[^']*'|\S+)/g, `$1${REDACTED}`);
  out = out.replace(/(--auth-(?:code|key)=)\S+/g, `$1${REDACTED}`);
  out = out.replace(/(confirmation pin:\s*)\S+/gi, `$1${REDACTED}`);
  out = out.replace(/(session(?: id)?[:=]\s*)[A-Za-z0-9_-]{20,}/gi, `$1${REDACTED}`);
  return maskEmailsIn(out);
}
