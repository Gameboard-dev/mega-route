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

/** The vault, as the walk sees it (core/vaultfs.ts: Obsidian's adapter). Paths are vault-relative, "" is the top. */
export interface WalkFs {
  /** The names of the files and folders directly in a folder (hidden ones included). */
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  /** A file's size in bytes (null when unknown). */
  size(path: string): Promise<number | null>;
}

export interface Coverage {
  files: number;
  bytes: number;
  approximate: string[];
  ms: number;
}

/**
 * Counts the vault's files that the rules let through. Symbolic links are followed by the listing (MEGA does not sync
 * them), which matters only in a vault that holds links.
 */
export async function countCovered(fs: WalkFs, rules: Rules): Promise<Coverage> {
  const started = Date.now();
  const approximate = [...rules.approximate];
  let files = 0;
  let bytes = 0;
  const queue: string[] = [""];
  const sizes: Promise<void>[] = [];
  let nestedIgnore = false;
  while (queue.length) {
    const rel = queue.pop()!;
    let entries: { files: string[]; folders: string[] };
    try {
      entries = await fs.list(rel);
    } catch {
      approximate.push(`a folder that could not be read: ${rel || "(the vault)"}`);
      continue;
    }
    const top = rel === "";
    for (const name of entries.folders) {
      // MEGA's local bin of files deleted on MEGA, at the top of the sync, is never synced.
      if (top && name === ".debris") continue;
      const path = top ? name : `${rel}/${name}`;
      if (included(rules, path, name, "d", top)) queue.push(path);
    }
    for (const name of entries.files) {
      const path = top ? name : `${rel}/${name}`;
      if (name === ".megaignore") {
        if (!top) nestedIgnore = true;
        if (top && !rules.syncIgnoreFile) continue;
      }
      if (!included(rules, path, name, "f", top)) continue;
      const counted = rules.largerThan !== null || rules.smallerThan !== null;
      if (!counted) files++;
      sizes.push(
        fs.size(path).then(
          (size) => {
            if (size === null) return;
            if (counted) {
              if ((rules.largerThan !== null && size > rules.largerThan) || (rules.smallerThan !== null && size < rules.smallerThan)) return;
              files++;
            }
            bytes += size;
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
