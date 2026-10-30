// The exclusions, written as MEGA's own rules into the `.megaignore` file at the top of the vault.
//
// MEGA's sync engine (in MEGAcmd and in the MEGA desktop app) reads `.megaignore` in the sync's root folder. Its rules
// are `<CLASS><TARGET><TYPE><STRATEGY>:<PATTERN>`, for example `-p:.trash` (exclude the path .trash) or `+dN:.obsidian`
// (include the folder .obsidian in the root). Facts this module relies on, from MEGA's help page
// (https://help.mega.io/installs-apps/desktop/megaignore) and the MEGA SDK (src/syncfilter.cpp, src/utils.cpp):
//   - the LAST rule that matches a name decides (the SDK walks the rules from the end);
//   - glob patterns know only `*` (any characters, `/` included) and `?` (one character), matched case-insensitively
//     unless the strategy is an upper-case `G`;
//   - `p` rules match the path relative to the folder holding the file, with `/` as the separator, even on Windows;
//   - a line starting with `#` is a comment; a rule that does not parse stalls the whole folder's sync.
//
// The plugin owns one block, between the BEGIN and END lines below, which it always puts at the end of the file (so its
// rules win over the lines above them). Everything outside the block is left exactly as it was, so rules written by
// hand or by the MEGA desktop app stay in force.

export const BLOCK_BEGIN = "# BEGIN MEGA-Route (written by the Obsidian plugin MEGA-Route: change these rules in its settings, not here)";
export const BLOCK_END = "# END MEGA-Route";

/** MEGA's default rules, written above the block only when the vault has no `.megaignore` yet (as MEGA would). */
export const MEGA_DEFAULT_RULES = ["-:Thumbs.db", "-:desktop.ini", "-:~*", "-:.*", "-:*~.*", "-:*.crdownload", "-:*.sb-????????-??????", "-:*.tmp"];

/** A byte-order mark, kept if the file starts with one. */
const BOM = String.fromCharCode(0xfeff);

/** C0 control characters, DEL, and the Unicode line and paragraph separators (U+2028, U+2029). */
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}
const CONTROL = { test: hasControl };

export interface IgnoreOptions {
  /** Obsidian's configuration folder, relative to the vault (normally `.obsidian`). */
  configDir: string;
  /** The plugin's own folder, relative to the vault (from the manifest; normally `.obsidian/plugins/mega-route`). */
  pluginDir: string;
  /** Glob patterns (one per line) of vault paths to leave out. */
  excludePatterns: string;
  /** Glob patterns (one per line) of vault paths to sync even when another rule leaves them out. */
  includePatterns: string;
  /** Sync Obsidian's configuration folder (settings, plugins, themes), which MEGA's default `-:.*` rule leaves out. */
  syncConfigFolder: boolean;
}

export interface MappedPattern {
  pattern: string;
  rule: string;
}

export interface PatternProblem {
  pattern: string;
  reason: string;
}

export interface IgnoreBlock {
  /** The rules of the block, in order. */
  rules: string[];
  /** The fixed rules (always written). */
  fixed: string[];
  mapped: MappedPattern[];
  problems: PatternProblem[];
}

/** Paths in a pattern or folder setting are relative to the vault, with `/`. */
function clean(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Characters that are special in a POSIX extended regular expression, each written as a one-character bracket
 *  expression (`[.]`), which needs no backslash. `^` is not special inside a bracket only when it is not first, so it
 *  is the one written with a backslash, which ERE allows for it. */
const ERE_LITERAL: Record<string, string> = { ".": "[.]", "(": "[(]", ")": "[)]", "+": "[+]", $: "[$]", "|": "[|]", "{": "[{]", "[": "[[]", "^": "\\^" };

/**
 * A pattern of the plugin's syntax as a POSIX extended regular expression with exactly its meaning. MEGA matches `r`
 * rules against the whole path with `std::regex_match` (src/syncfilter.cpp), so the expression is anchored at both ends.
 *   `*`   any characters within one folder or file name: `[^/]*`
 *   `**`  any characters, across folders: `.*`; `**` followed by `/`: any folders, or none (an optional group of
 *         any characters ending in a slash)
 *   `?`   one character other than `/`: `[^/]`
 * Every other character stands for itself.
 */
export function globToEre(p: string): string {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        if (p[i + 2] === "/") {
          out += "(.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += ERE_LITERAL[c] ?? c;
  }
  return out;
}

/**
 * One pattern of the plugin's settings (relative to the vault's top; `*` within one name, `**` across folders, `?` one
 * character) as a MEGA rule of class `cls` that matches exactly what the pattern says:
 *   - no wildcard: `-p:path` (that file, or that folder and everything in it);
 *   - `folder/**` or `folder/` with no wildcard in `folder`: `-p:folder`;
 *   - `**` followed by a name with no `/`: `-n:name` (that name in any folder; MEGA's `n` rules see one name, so its
 *     `*` cannot cross a folder);
 *   - anything else with a wildcard: `-pr:<expression>` (a case-insensitive regular expression over the whole path),
 *     because MEGA's glob `*` also matches `/` (the SDK's `wildcardMatch`, src/utils.cpp), which would widen the rule.
 * MEGA ignores letter case in all of these, as in its own default rules.
 */
export function mapPattern(raw: string, cls: "-" | "+", configDir: string): MappedPattern | PatternProblem {
  const pattern = raw.trim();
  if (CONTROL.test(raw.replace(/\r?\n$/, ""))) return { pattern, reason: "contains a control character" };
  if (pattern.length > 512) return { pattern: pattern.slice(0, 80) + "…", reason: "is longer than 512 characters" };
  const p = clean(pattern);
  if (!p) return { pattern, reason: "is empty" };
  // Patterns that would leave out the whole vault, or Obsidian's settings folder, are refused.
  if (cls === "-" && /^[*/]+$/.test(p)) return { pattern, reason: "would leave out the whole vault" };
  const cfg = clean(configDir).replace(/\/+$/, "");
  if (cls === "-" && cfg && p.replace(/(\/\*\*)?\/?$/, "").toLowerCase() === cfg.toLowerCase()) {
    return { pattern, reason: `would leave out Obsidian's settings folder (${cfg}); turn off "Sync Obsidian's settings folder" instead` };
  }
  const wild = (s: string) => /[*?]/.test(s);
  // `folder/**` or `folder/`: the folder and everything in it.
  const folder = /^(.*?)\/(\*\*)?$/.exec(p);
  if (folder && folder[1] && !wild(folder[1])) return { pattern, rule: `${cls}p:${folder[1]}` };
  if (!wild(p)) return { pattern, rule: `${cls}p:${p}` };
  // `**/name`: that name in any folder.
  const anywhere = /^\*\*\/([^/]+)$/.exec(p);
  if (anywhere) return { pattern, rule: `${cls}n:${anywhere[1]}` };
  return { pattern, rule: `${cls}pr:${globToEre(p)}` };
}

/** The plugin's block of rules, from the settings. */
export function buildBlock(o: IgnoreOptions): IgnoreBlock {
  // Both come from Obsidian (Vault#configDir, the manifest's dir): the configuration folder can be renamed.
  const configDir = clean(o.configDir);
  if (!configDir) throw new Error("Obsidian's configuration folder is not known, so no rules were made.");
  const pluginDir = clean(o.pluginDir) || `${configDir}/plugins/mega-route`;
  // The folder of versions up to 3.0.1 (id mega-sync-fork): on a device not yet moved it holds 2.x's sign-in data and
  // caches, which must never be synced.
  const legacyDir = `${configDir}/plugins/mega-sync-fork`;
  const mapped: MappedPattern[] = [];
  const problems: PatternProblem[] = [];
  const userRules = (text: string, cls: "-" | "+") => {
    const out: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = mapPattern(line, cls, configDir);
      if ("rule" in m) {
        mapped.push(m);
        out.push(m.rule);
      } else problems.push(m);
    }
    return out;
  };
  const fixed = [
    // Obsidian's window layout, different on every device.
    `-p:${configDir}/workspace*`,
    // This plugin's own folder: per-device files, and the earlier versions' sync state and caches.
    `-p:${pluginDir}`,
    ...(legacyDir !== pluginDir ? [`-p:${legacyDir}`] : []),
    // Obsidian's own bin of deleted files ("Move to Obsidian trash").
    "-p:.trash",
    // What the plugin's earlier versions (2.x) kept in the MEGA folder: their sync state, deletion bin and conflicts.
    "-fN:_mega_sync_snapshot.json",
    "-N:.mega-sync-bin",
    "-N:.mega-sync-conflicts",
  ];
  for (const r of [...fixed, configDir, pluginDir]) {
    if (CONTROL.test(r)) throw new Error(`A folder name holds a control character: ${JSON.stringify(r)}`);
  }
  const rules: string[] = [];
  if (o.syncConfigFolder) rules.push(`+dN:${configDir}`);
  rules.push(...userRules(o.excludePatterns, "-"));
  rules.push(...userRules(o.includePatterns, "+"));
  // The fixed rules come last, so no other rule can bring these paths back into the sync.
  rules.push(...fixed);
  return { rules, fixed, mapped, problems };
}

/** The file's text with the plugin's block replaced (or added at the end); everything else is kept as it was. */
export function mergeIgnoreFile(existing: string | null, rules: readonly string[]): string {
  const block = [BLOCK_BEGIN, ...rules, BLOCK_END];
  if (existing === null) {
    return [...MEGA_DEFAULT_RULES, "", ...block, ""].join("\n");
  }
  const bom = existing.startsWith(BOM) ? BOM : "";
  const body = bom ? existing.slice(1) : existing;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (!inside && line.startsWith("# BEGIN MEGA-Route")) {
      inside = true;
      continue;
    }
    if (inside) {
      if (line.startsWith(BLOCK_END)) inside = false;
      continue;
    }
    kept.push(line);
  }
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  const out = kept.length ? [...kept, "", ...block, ""] : [...block, ""];
  return bom + out.join(eol);
}

/** The plugin's block as it is in a file now (null when there is none). */
export function readBlock(existing: string | null): string[] | null {
  if (existing === null) return null;
  const lines = (existing.startsWith(BOM) ? existing.slice(1) : existing).split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("# BEGIN MEGA-Route"));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith(BLOCK_END));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}
