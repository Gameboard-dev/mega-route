// Which of the vault's files the sync covers: the vault's `.megaignore` evaluated as MEGA's sync engine reads it, and a
// walk of the vault that counts the files (and their bytes) it lets through. Used for the progress of a sync run:
// "files in sync ÷ files the sync covers". No file is opened or hashed; directory listings and sizes only.
//
// How MEGA reads the rules (help.mega.io/installs-apps/desktop/megaignore; MEGA SDK src/syncfilter.cpp, src/utils.cpp):
//   - `<CLASS><TARGET><TYPE><STRATEGY>:<PATTERN>`: CLASS - or +; TARGET a (default), d, f, s; TYPE N (names in the
//     folder holding the file only), n (names at every depth), p (the path relative to that folder); without a TYPE,
//     p when the pattern holds a "/", else n; STRATEGY g (default) or G (glob; G case-sensitive), r or R (POSIX
//     extended regular expression over the whole name or path; R case-sensitive);
//   - the LAST rule that matches decides; an excluded folder is not entered;
//   - glob `*` matches any characters, "/" included, `?` one character (wildcardMatch);
//   - `exclude-larger:` / `exclude-smaller:` size limits apply to files not yet synced;
//   - the `.megaignore` file itself is not synced unless the file says `+sync:.megaignore`.

export interface Rule {
  include: boolean;
  target: "a" | "d" | "f" | "s";
  type: "N" | "n" | "p";
  regex: boolean;
  caseSensitive: boolean;
  pattern: string;
  re?: RegExp;
}

export interface Rules {
  rules: Rule[];
  largerThan: number | null;
  smallerThan: number | null;
  syncIgnoreFile: boolean;
  /** Why the count may differ from MEGA's (empty when it is exact). */
  approximate: string[];
}

const UNIT: Record<string, number> = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

/** The rules of a `.megaignore` text (null: no file, MEGA's defaults are not assumed). */
export function parseRules(text: string | null): Rules {
  const out: Rules = { rules: [], largerThan: null, smallerThan: null, syncIgnoreFile: false, approximate: [] };
  if (text === null) return out;
  for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.startsWith("#")) continue;
    if (/^[+-]sync:\.megaignore$/.test(line)) {
      out.syncIgnoreFile = line.startsWith("+");
      continue;
    }
    const size = /^exclude-(larger|smaller):\s*(\d+)\s*([kmgt]?)$/i.exec(line);
    if (size) {
      const bytes = Number(size[2]) * UNIT[size[3].toLowerCase()];
      if (size[1].toLowerCase() === "larger") out.largerThan = bytes;
      else out.smallerThan = bytes;
      if (!out.approximate.includes("size limits")) out.approximate.push("size limits (MEGA applies them only to files not yet synced)");
      continue;
    }
    const m = /^([+-])([adfs]?)([Nnp]?)([GgRr]?):(.*)$/.exec(line);
    if (!m) {
      out.approximate.push(`a line MEGA would not accept (it stops the sync of that folder): ${line.slice(0, 60)}`);
      continue;
    }
    const pattern = m[5];
    const rule: Rule = {
      include: m[1] === "+",
      target: (m[2] || "a") as Rule["target"],
      type: (m[3] || (pattern.includes("/") ? "p" : "n")) as Rule["type"],
      regex: m[4] === "r" || m[4] === "R",
      caseSensitive: m[4] === "G" || m[4] === "R",
      pattern,
    };
    if (rule.regex) {
      if (/\[\[[:=.]/.test(pattern) || /\\[1-9]/.test(pattern)) out.approximate.push(`a regular expression this count reads differently from MEGA: ${pattern.slice(0, 60)}`);
      try {
        rule.re = new RegExp(`^(?:${pattern})$`, rule.caseSensitive ? "" : "i");
      } catch {
        out.approximate.push(`a regular expression this count cannot read: ${pattern.slice(0, 60)}`);
        continue;
      }
    }
    out.rules.push(rule);
  }
  return out;
}

/** MEGA's wildcardMatch (src/utils.cpp): `*` any characters ("/" included), `?` one character. */
export function wildcardMatch(text: string, pattern: string): boolean {
  let s = 0;
  let p = 0;
  let star = -1;
  let mark = 0;
  while (s < text.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[s])) {
      s++;
      p++;
    } else if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      mark = s;
    } else if (star >= 0) {
      p = star + 1;
      s = ++mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

function matches(r: Rule, text: string): boolean {
  if (r.re) return r.re.test(text);
  return r.caseSensitive ? wildcardMatch(text, r.pattern) : wildcardMatch(text.toUpperCase(), r.pattern.toUpperCase());
}

/** Whether MEGA syncs the item at `path` (relative, "/"-separated), with name `name`, directly in the root when `top`. */
export function included(rules: Rules, path: string, name: string, kind: "d" | "f" | "s", top: boolean): boolean {
  for (let i = rules.rules.length - 1; i >= 0; i--) {
    const r = rules.rules[i];
    if (r.target !== "a" && r.target !== kind) continue;
    if (r.type === "N" && !top) continue;
    if (matches(r, r.type === "p" ? path : name)) return r.include;
  }
  return true;
}

export interface DirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface WalkFs {
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
  stat(path: string): Promise<{ size: number }>;
}

export interface Coverage {
  files: number;
  bytes: number;
  approximate: string[];
  ms: number;
}

/** Counts the files under `root` that the rules let through (symbolic links are not synced by MEGA, so not counted). */
export async function countCovered(fs: WalkFs, root: string, rules: Rules, sep = "/"): Promise<Coverage> {
  const started = Date.now();
  const approximate = [...rules.approximate];
  let files = 0;
  let bytes = 0;
  const queue: { abs: string; rel: string }[] = [{ abs: root, rel: "" }];
  const sizes: Promise<void>[] = [];
  let nestedIgnore = false;
  while (queue.length) {
    const { abs, rel } = queue.pop()!;
    let entries: DirEntry[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      approximate.push(`a folder that could not be read: ${rel || "(the vault)"}`);
      continue;
    }
    for (const e of entries) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      const top = rel === "";
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        // MEGA's local bin of files deleted on MEGA, at the top of the sync, is never synced.
        if (top && e.name === ".debris") continue;
        if (included(rules, path, e.name, "d", top)) queue.push({ abs: abs + sep + e.name, rel: path });
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name === ".megaignore") {
        if (!top) nestedIgnore = true;
        if (top && !rules.syncIgnoreFile) continue;
      }
      if (!included(rules, path, e.name, "f", top)) continue;
      const file = abs + sep + e.name;
      const counted = rules.largerThan !== null || rules.smallerThan !== null;
      if (!counted) files++;
      sizes.push(
        fs.stat(file).then(
          (st) => {
            if (counted) {
              if ((rules.largerThan !== null && st.size > rules.largerThan) || (rules.smallerThan !== null && st.size < rules.smallerThan)) return;
              files++;
            }
            bytes += st.size;
          },
          () => undefined,
        ),
      );
      if (sizes.length >= 256) await Promise.all(sizes.splice(0));
    }
  }
  await Promise.all(sizes);
  if (nestedIgnore) approximate.push(".megaignore files inside sub-folders (only the vault's own is read)");
  return { files, bytes, approximate, ms: Date.now() - started };
}
