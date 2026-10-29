// Checks on every path and id that is passed to MEGAcmd, and comparisons of local paths.
//
// Why so strict: on Windows, MEGAcmd's client (MegaClient.exe) joins its arguments back into one line for its server,
// quoting only those with spaces and never escaping a quotation mark. A path holding `"` could therefore split into
// extra arguments on the server's side, and an argument starting with `-` would be read as an option. The MEGA folder
// comes from the vault's data.json, which other devices (or anyone who can write to the vault) can change, so it is
// checked before every use, not only when it is typed.

export type Checked = { ok: true; value: string } | { ok: false; reason: string };

/** C0 control characters, DEL, and the Unicode line and paragraph separators (U+2028, U+2029). */
export function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}
const CONTROL = { test: hasControl };

/** The MEGA folder: an absolute path in the Cloud Drive, such as `/RAG` or `/Notes/Vault`. */
export function checkRemoteFolder(input: unknown): Checked {
  if (typeof input !== "string") return { ok: false, reason: "The MEGA folder is not text." };
  const s = input.trim();
  if (!s) return { ok: false, reason: "The MEGA folder is empty." };
  if (s.length > 1024) return { ok: false, reason: "The MEGA folder's path is longer than 1024 characters." };
  if (CONTROL.test(s)) return { ok: false, reason: "The MEGA folder contains a control character (such as a line break)." };
  if (s.includes('"')) return { ok: false, reason: 'The MEGA folder contains a quotation mark ("), which MEGAcmd cannot pass on safely.' };
  if (s.includes("\\")) return { ok: false, reason: "Use / between folder names in the MEGA folder, not \\." };
  if (!s.startsWith("/")) return { ok: false, reason: "The MEGA folder must start with / (the top of your Cloud Drive), for example /RAG." };
  // `//bin` is MEGAcmd's Rubbish Bin, `//in` the Vault (backups), `//from` incoming shares.
  if (s.startsWith("//")) return { ok: false, reason: "The MEGA folder must be in your Cloud Drive (one leading /), not in the Rubbish Bin (//bin), the Vault (//in) or an incoming share." };
  if (s === "/") return { ok: false, reason: "The MEGA folder cannot be the whole Cloud Drive (/): choose a folder in it, such as /RAG." };
  const body = s.endsWith("/") ? s.slice(0, -1) : s;
  const parts = body.slice(1).split("/");
  for (const p of parts) {
    if (p === "") return { ok: false, reason: "The MEGA folder has an empty folder name (two / in a row)." };
    if (p === "." || p === "..") return { ok: false, reason: "The MEGA folder cannot contain . or .. as a folder name." };
    if (p !== p.trim()) return { ok: false, reason: `The folder name "${p}" starts or ends with a space.` };
    if (p.startsWith("-")) return { ok: false, reason: `The folder name "${p}" starts with -, which MEGAcmd would read as an option.` };
  }
  return { ok: true, value: body };
}

/** The vault's folder on this device (from Obsidian), checked before it is passed to MEGAcmd. */
export function checkLocalFolder(input: unknown, windows: boolean): Checked {
  if (typeof input !== "string" || !input) return { ok: false, reason: "The vault's folder on this device is unknown." };
  if (input.length > 4096) return { ok: false, reason: "The vault's folder path is too long." };
  if (CONTROL.test(input)) return { ok: false, reason: "The vault's folder path contains a control character." };
  if (input.includes('"')) return { ok: false, reason: 'The vault\'s folder path contains a quotation mark ("), which MEGAcmd cannot pass on safely.' };
  if (input.startsWith("-")) return { ok: false, reason: "The vault's folder path starts with -." };
  const absolute = windows ? /^[A-Za-z]:[\\/]/.test(input) || /^\\\\[^\\]/.test(input) : input.startsWith("/");
  if (!absolute) return { ok: false, reason: `The vault's folder path is not absolute: ${input}` };
  return { ok: true, value: input };
}

/** A sync's id as MEGAcmd prints it (base64-like). One starting with `-` would be read as an option, so it is refused
 *  here and the caller names the sync by its folder instead. */
export function checkSyncId(input: unknown): Checked {
  if (typeof input !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(input)) return { ok: false, reason: `Not a MEGAcmd sync id that can be passed safely: ${String(input).slice(0, 80)}` };
  return { ok: true, value: input };
}

/** A local path in a comparable form: no `\\?\` prefix, one kind of separator, no trailing separator; lower case on Windows. */
export function normaliseLocal(p: string, windows: boolean): string {
  let s = p.trim();
  if (windows) {
    s = s.replace(/\//g, "\\");
    if (s.startsWith("\\\\?\\UNC\\")) s = "\\\\" + s.slice(8);
    else if (s.startsWith("\\\\?\\")) s = s.slice(4);
    while (s.length > 3 && s.endsWith("\\")) s = s.slice(0, -1);
    return s.toLowerCase();
  }
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

export function sameLocal(a: string, b: string, windows: boolean): boolean {
  return normaliseLocal(a, windows) === normaliseLocal(b, windows);
}

/** Whether `inner` is strictly inside `outer`. */
export function isInside(inner: string, outer: string, windows: boolean): boolean {
  const i = normaliseLocal(inner, windows);
  const o = normaliseLocal(outer, windows);
  const sep = windows ? "\\" : "/";
  return i !== o && i.startsWith(o.endsWith(sep) ? o : o + sep);
}

/** MEGA folder paths compare case-sensitively; a trailing / is ignored. */
export function sameRemote(a: string, b: string): boolean {
  const n = (s: string) => (s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s);
  return n(a.trim()) === n(b.trim());
}

/** Whether MEGA folder `inner` is strictly inside `outer`. */
export function isRemoteInside(inner: string, outer: string): boolean {
  const n = (s: string) => (s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s);
  const i = n(inner.trim());
  const o = n(outer.trim());
  return i !== o && i.startsWith(o === "/" ? "/" : o + "/");
}
