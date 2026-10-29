/* MEGA-Route, an Obsidian plugin (MIT licence). Built with esbuild from the TypeScript in src/: https://github.com/Gameboard-dev/mega-route */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MegaRoutePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/core/parse.ts
var COL_SEP = "~|~";
var MCMD = {
  EARGS: 51,
  INVALIDEMAIL: 52,
  NOTFOUND: 53,
  INVALIDSTATE: 54,
  INVALIDTYPE: 55,
  NOTPERMITTED: 56,
  NOTLOGGEDIN: 57,
  NOFETCH: 58,
  EUNEXPECTED: 59,
  REQCONFIRM: 60,
  EXISTS: 64
};
function outcome(r, what) {
  const text = firstLines(r.stderr || r.stdout);
  if (r.spawnError) return { kind: "not-started", message: `${what}: MEGAcmd could not be started (${r.spawnError}).` };
  if (r.timedOut) return { kind: "timeout", message: `${what}: MEGAcmd did not answer within the time limit (${Math.round(r.ms / 1e3)} s).` };
  if (r.code === 0) return { kind: "ok" };
  if (r.code === MCMD.NOTLOGGEDIN || /not logged in/i.test(text)) return { kind: "not-logged-in", message: `${what}: MEGAcmd is not signed in to a MEGA account.` };
  if (r.code === MCMD.NOTFOUND) return { kind: "not-found", message: `${what}: ${text || "not found"}` };
  if (r.code === MCMD.EXISTS) return { kind: "exists", message: `${what}: ${text || "already exists"}` };
  return { kind: "failed", message: `${what}: MEGAcmd answered with code ${r.code}${text ? `: ${text}` : ""}` };
}
function firstLines(s, n = 3) {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, n).join(" / ").slice(0, 500);
}
function parseVersion(stdout) {
  const m = /MEGAcmd version:\s*([0-9]+(?:\.[0-9]+){1,3})/i.exec(stdout);
  return m ? m[1] : null;
}
function parseWhoami(stdout) {
  const m = /Account e-mail:\s*(\S+@\S+)/i.exec(stdout);
  return m ? m[1] : null;
}
function maskEmail(email) {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${name[0] ?? ""}***${tld}`;
}
var SYNC_COLUMNS = ["ID", "LOCALPATH", "REMOTEPATH", "RUN_STATE", "STATUS", "ERROR", "SIZE", "FILES", "DIRS"];
function parseSyncList(stdout, sep = COL_SEP) {
  const rows = [];
  const problems = [];
  let header = null;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.includes(sep)) continue;
    const cells = line.split(sep).map((c) => c.trim());
    if (!header) {
      if (cells.includes("ID") && cells.includes("LOCALPATH")) header = cells;
      else problems.push(`Unexpected line before the header: ${line.slice(0, 200)}`);
      continue;
    }
    if (cells.length !== header.length) {
      problems.push(`A row has ${cells.length} columns, the header ${header.length}: ${line.slice(0, 200)}`);
      continue;
    }
    const get = (name) => {
      const i = header.indexOf(name);
      return i >= 0 ? cells[i] : "";
    };
    const num = (s) => /^\d+$/.test(s) ? Number(s) : null;
    rows.push({
      id: get("ID"),
      localPath: get("LOCALPATH"),
      remotePath: get("REMOTEPATH"),
      runState: get("RUN_STATE"),
      status: get("STATUS"),
      error: get("ERROR"),
      size: get("SIZE"),
      files: num(get("FILES")),
      dirs: num(get("DIRS"))
    });
  }
  return { rows, problems };
}
function sizeToBytes(s) {
  const m = /^([0-9.]+)\s*([KMGTP]?)B$/.exec(s.trim());
  if (!m) return null;
  const pow = { "": 0, K: 1, M: 2, G: 3, T: 4, P: 5 }[m[2]];
  return Number(m[1]) * Math.pow(1024, pow);
}
var SIZE = String.raw`([0-9.]+\s+[KMGTP]?B)`;
var PCT = String.raw`([0-9.]+|-+)%`;
var SUMMARY_ROW = new RegExp(String.raw`^\s*(\d+)\s+${SIZE}\s+${SIZE}\s+${PCT}\s+(\d+)\s+${SIZE}\s+${SIZE}\s+${PCT}\s*$`);
function parseTransferSummary(stdout) {
  for (const line of stdout.split(/\r?\n/)) {
    const m = SUMMARY_ROW.exec(line);
    if (!m) continue;
    const pct = (s) => /^[0-9.]+$/.test(s) ? Number(s) : null;
    return {
      downloads: Number(m[1]),
      downloaded: m[2].replace(/\s+/g, " "),
      downloadTotal: m[3].replace(/\s+/g, " "),
      downloadPercent: pct(m[4]),
      uploads: Number(m[5]),
      uploaded: m[6].replace(/\s+/g, " "),
      uploadTotal: m[7].replace(/\s+/g, " "),
      uploadPercent: pct(m[8])
    };
  }
  return null;
}
var TRANSFER_COLUMNS = ["TYPE", "TAG", "SOURCEPATH", "DESTINYPATH", "PROGRESS", "STATE"];
function parseTransferList(stdout, sep = COL_SEP) {
  const out = [];
  let header = null;
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.includes(sep)) continue;
    const cells = raw.split(sep).map((c) => c.trim());
    if (!header) {
      if (cells.includes("TAG") && cells.includes("STATE")) header = cells;
      continue;
    }
    const get = (name) => {
      const i = header.indexOf(name);
      return i >= 0 && i < cells.length ? cells[i] : "";
    };
    out.push({ type: get("TYPE"), tag: get("TAG"), source: get("SOURCEPATH"), destination: get("DESTINYPATH"), progress: get("PROGRESS"), state: get("STATE") });
  }
  return out;
}
var LIVE_TRANSFER_STATES = /* @__PURE__ */ new Set(["QUEUED", "ACTIVE", "PAUSED", "RETRYING", "COMPLETING"]);
function parseSyncIssues(stdout, sep = COL_SEP) {
  const out = [];
  let header = null;
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.includes(sep)) continue;
    const cells = raw.split(sep).map((c) => c.trim());
    if (!header) {
      if (cells.includes("ISSUE_ID")) header = cells;
      continue;
    }
    const get = (name) => {
      const i = header.indexOf(name);
      return i >= 0 && i < cells.length ? cells[i] : "";
    };
    out.push({ id: get("ISSUE_ID"), sync: get("PARENT_SYNC"), reason: get("REASON") });
  }
  return out;
}
function parseLs(stdout, folder) {
  const heading = /* @__PURE__ */ new Set([`${folder}:`, `${folder}/:`]);
  return stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !heading.has(l));
}
function parseProcessNames(stdout, windows) {
  const names = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (windows) {
      const m = /^"([^"]*)"/.exec(line);
      if (m) names.push(m[1]);
    } else {
      const base = line.split("/").pop() ?? line;
      names.push(base);
    }
  }
  return names;
}

// src/core/secrets.ts
function hasControl(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127 || c === 8232 || c === 8233) return true;
  }
  return false;
}
function checkEmail(input) {
  if (typeof input !== "string") return { ok: false, reason: "The email address is missing." };
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
function checkPassword(input) {
  if (typeof input !== "string" || input.length === 0) return { ok: false, reason: "Type your MEGA password." };
  if (input.length > 1024) return { ok: false, reason: "The password is longer than 1024 characters." };
  if (hasControl(input)) return { ok: false, reason: "The password contains a control character (such as a line break or a tab), which MEGAcmd cannot be given from here." };
  const cannot = "MEGAcmd's command-line client cannot be given it unchanged; sign in once in MEGAcmd itself (open MEGAcmd from your Start menu or a terminal, and type: login followed by your email), then press Refresh.";
  if (input.includes('"')) return { ok: false, reason: `The password contains a quotation mark ("). ${cannot}` };
  if (input.startsWith("-")) return { ok: false, reason: `The password starts with -. ${cannot}` };
  if (input.startsWith("'") && !/\s/.test(input)) return { ok: false, reason: `The password starts with ' (and has no space). ${cannot}` };
  return { ok: true, value: input };
}
function checkCode(input) {
  if (typeof input !== "string") return { ok: false, reason: "Type the six-digit code from your authenticator app." };
  const s = input.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(s)) return { ok: false, reason: "The two-factor code is six digits, from your authenticator app." };
  return { ok: true, value: s };
}
var REDACTED = "[redacted]";
function redactText(text, secrets = []) {
  let out = text;
  for (const s of [...secrets].filter((x) => x && x.length > 0).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(REDACTED);
  }
  return maskEmailsIn(out);
}
var EMAIL = /[A-Za-z0-9._%+!#$&*/=?^`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
function maskEmailsIn(text) {
  return text.replace(EMAIL, (m) => maskEmail(m));
}
function redactMegaCmdLine(line) {
  let out = line;
  out = out.replace(/\b(X?login\s+)(?!<REDACTED>)(\S+@\S+|[A-Za-z0-9_-]{30,}|https?:\S+).*$/i, `$1${REDACTED}`);
  out = out.replace(/\b(X?(?:passwd|confirmcancel|confirm)\s+)(?!<REDACTED>)\S.*$/i, `$1${REDACTED}`);
  out = out.replace(/(--password=)("[^"]*"|'[^']*'|\S+)/g, `$1${REDACTED}`);
  out = out.replace(/(--auth-(?:code|key)=)\S+/g, `$1${REDACTED}`);
  out = out.replace(/(confirmation pin:\s*)\S+/gi, `$1${REDACTED}`);
  out = out.replace(/(session(?: id)?[:=]\s*)[A-Za-z0-9_-]{20,}/gi, `$1${REDACTED}`);
  return maskEmailsIn(out);
}

// src/core/paths.ts
function hasControl2(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127 || c === 8232 || c === 8233) return true;
  }
  return false;
}
var CONTROL = { test: hasControl2 };
function checkRemoteFolder(input) {
  if (typeof input !== "string") return { ok: false, reason: "The MEGA folder is not text." };
  const s = input.trim();
  if (!s) return { ok: false, reason: "The MEGA folder is empty." };
  if (s.length > 1024) return { ok: false, reason: "The MEGA folder's path is longer than 1024 characters." };
  if (CONTROL.test(s)) return { ok: false, reason: "The MEGA folder contains a control character (such as a line break)." };
  if (s.includes('"')) return { ok: false, reason: 'The MEGA folder contains a quotation mark ("), which MEGAcmd cannot pass on safely.' };
  if (s.includes("\\")) return { ok: false, reason: "Use / between folder names in the MEGA folder, not \\." };
  if (!s.startsWith("/")) return { ok: false, reason: "The MEGA folder must start with / (the top of your Cloud Drive), for example /RAG." };
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
function checkLocalFolder(input, windows) {
  if (typeof input !== "string" || !input) return { ok: false, reason: "The vault's folder on this device is unknown." };
  if (input.length > 4096) return { ok: false, reason: "The vault's folder path is too long." };
  if (CONTROL.test(input)) return { ok: false, reason: "The vault's folder path contains a control character." };
  if (input.includes('"')) return { ok: false, reason: `The vault's folder path contains a quotation mark ("), which MEGAcmd cannot pass on safely.` };
  if (input.startsWith("-")) return { ok: false, reason: "The vault's folder path starts with -." };
  const absolute = windows ? /^[A-Za-z]:[\\/]/.test(input) || /^\\\\[^\\]/.test(input) : input.startsWith("/");
  if (!absolute) return { ok: false, reason: `The vault's folder path is not absolute: ${input}` };
  return { ok: true, value: input };
}
function checkSyncId(input) {
  if (typeof input !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(input)) return { ok: false, reason: `Not a MEGAcmd sync id that can be passed safely: ${String(input).slice(0, 80)}` };
  return { ok: true, value: input };
}
function normaliseLocal(p, windows) {
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
function sameLocal(a, b, windows) {
  return normaliseLocal(a, windows) === normaliseLocal(b, windows);
}
function isInside(inner, outer, windows) {
  const i = normaliseLocal(inner, windows);
  const o = normaliseLocal(outer, windows);
  const sep = windows ? "\\" : "/";
  return i !== o && i.startsWith(o.endsWith(sep) ? o : o + sep);
}
function sameRemote(a, b) {
  const n = (s) => s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s;
  return n(a.trim()) === n(b.trim());
}
function isRemoteInside(inner, outer) {
  const n = (s) => s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s;
  const i = n(inner.trim());
  const o = n(outer.trim());
  return i !== o && i.startsWith(o === "/" ? "/" : o + "/");
}

// src/core/megaignore.ts
var BLOCK_BEGIN = "# BEGIN MEGA-Route (written by the Obsidian plugin MEGA-Route: change these rules in its settings, not here)";
var BLOCK_END = "# END MEGA-Route";
var MEGA_DEFAULT_RULES = ["-:Thumbs.db", "-:desktop.ini", "-:~*", "-:.*", "-:*~.*", "-:*.crdownload", "-:*.sb-????????-??????", "-:*.tmp"];
var BOM = String.fromCharCode(65279);
function hasControl3(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127 || c === 8232 || c === 8233) return true;
  }
  return false;
}
var CONTROL2 = { test: hasControl3 };
function clean(p) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
var ERE_LITERAL = { ".": "[.]", "(": "[(]", ")": "[)]", "+": "[+]", $: "[$]", "|": "[|]", "{": "[{]", "[": "[[]", "^": "\\^" };
function globToEre(p) {
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
function mapPattern(raw, cls, configDir = ".obsidian") {
  const pattern = raw.trim();
  if (CONTROL2.test(raw.replace(/\r?\n$/, ""))) return { pattern, reason: "contains a control character" };
  if (pattern.length > 512) return { pattern: pattern.slice(0, 80) + "\u2026", reason: "is longer than 512 characters" };
  const p = clean(pattern);
  if (!p) return { pattern, reason: "is empty" };
  if (cls === "-" && /^[*/]+$/.test(p)) return { pattern, reason: "would leave out the whole vault" };
  const cfg = clean(configDir).replace(/\/+$/, "");
  if (cls === "-" && cfg && p.replace(/(\/\*\*)?\/?$/, "").toLowerCase() === cfg.toLowerCase()) {
    return { pattern, reason: `would leave out Obsidian's settings folder (${cfg}); turn off "Sync Obsidian's settings folder" instead` };
  }
  const wild = (s) => /[*?]/.test(s);
  const folder = /^(.*?)\/(\*\*)?$/.exec(p);
  if (folder && folder[1] && !wild(folder[1])) return { pattern, rule: `${cls}p:${folder[1]}` };
  if (!wild(p)) return { pattern, rule: `${cls}p:${p}` };
  const anywhere = /^\*\*\/([^/]+)$/.exec(p);
  if (anywhere) return { pattern, rule: `${cls}n:${anywhere[1]}` };
  return { pattern, rule: `${cls}pr:${globToEre(p)}` };
}
function buildBlock(o) {
  const configDir = clean(o.configDir) || ".obsidian";
  const pluginDir = clean(o.pluginDir) || `${configDir}/plugins/mega-route`;
  const legacyDir = `${configDir}/plugins/mega-sync-fork`;
  const mapped = [];
  const problems = [];
  const userRules = (text, cls) => {
    const out = [];
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
    ...legacyDir !== pluginDir ? [`-p:${legacyDir}`] : [],
    // Obsidian's own bin of deleted files ("Move to Obsidian trash").
    "-p:.trash",
    // What the plugin's earlier versions (2.x) kept in the MEGA folder: their sync state, deletion bin and conflicts.
    "-fN:_mega_sync_snapshot.json",
    "-N:.mega-sync-bin",
    "-N:.mega-sync-conflicts"
  ];
  for (const r of [...fixed, configDir, pluginDir]) {
    if (CONTROL2.test(r)) throw new Error(`A folder name holds a control character: ${JSON.stringify(r)}`);
  }
  const rules = [];
  if (o.syncConfigFolder) rules.push(`+dN:${configDir}`);
  rules.push(...userRules(o.excludePatterns, "-"));
  rules.push(...userRules(o.includePatterns, "+"));
  rules.push(...fixed);
  return { rules, fixed, mapped, problems };
}
function mergeIgnoreFile(existing, rules) {
  const block = [BLOCK_BEGIN, ...rules, BLOCK_END];
  if (existing === null) {
    return [...MEGA_DEFAULT_RULES, "", ...block, ""].join("\n");
  }
  const bom = existing.startsWith(BOM) ? BOM : "";
  const body = bom ? existing.slice(1) : existing;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const kept = [];
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

// src/core/progress.ts
var SMALL_RUN = 50;
var BUSY = /* @__PURE__ */ new Set(["Syncing", "Pending", "Processing"]);
var ProgressTracker = class {
  constructor() {
    this.best = 0;
    this.percentRun = false;
  }
  /** Starts a new run (after the sync is reported in sync, or when it is created or resumed). */
  reset() {
    this.best = 0;
    this.percentRun = false;
  }
  update(mine, transfers, local) {
    if (!mine) {
      this.reset();
      return null;
    }
    const remoteBytes = sizeToBytes(mine.size);
    if (mine.runState === "Running" && mine.status === "Synced") {
      this.reset();
      return { kind: "synced", files: mine.files, bytes: remoteBytes };
    }
    const up = transfers?.uploads ?? 0;
    const down = transfers?.downloads ?? 0;
    const left = transfers ? Math.max(0, (sizeToBytes(transfers.uploadTotal) ?? 0) - (sizeToBytes(transfers.uploaded) ?? 0)) + Math.max(0, (sizeToBytes(transfers.downloadTotal) ?? 0) - (sizeToBytes(transfers.downloaded) ?? 0)) : null;
    if (!BUSY.has(mine.status) && mine.runState !== "Loading" && mine.runState !== "Pending") return null;
    if (local === null || mine.files === null) {
      return { kind: up + down ? "few" : "scanning", up, down, leftBytes: left };
    }
    const total = Math.max(local.files, mine.files);
    const done = Math.min(local.files, mine.files);
    if (!this.percentRun && total - done < SMALL_RUN) {
      return { kind: up + down ? "few" : "scanning", up, down, leftBytes: left };
    }
    this.percentRun = true;
    const raw = total > 0 ? Math.floor(done / total * 100) : 0;
    this.best = Math.max(this.best, Math.min(99, raw));
    const totalBytes = remoteBytes === null ? null : Math.max(local.bytes, remoteBytes);
    const doneBytes = remoteBytes === null ? null : Math.min(local.bytes, remoteBytes);
    return { kind: "percent", percent: this.best, done, total, doneBytes, totalBytes, up, down, leftBytes: left, approximate: local.approximate.length > 0 };
  }
};
var STALL_MS = 12e4;
var RATE_WINDOW_MS = 6e4;
function shortName(path, max = 40) {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  if (name.length <= max) return name;
  const half = Math.floor((max - 1) / 2);
  return `${name.slice(0, half)}\u2026${name.slice(name.length - (max - 1 - half))}`;
}
var ActivityMeter = class {
  constructor() {
    this.samples = [];
    this.lastChange = -1;
    this.signature = "";
  }
  reset() {
    this.samples = [];
    this.lastChange = -1;
    this.signature = "";
  }
  observe(now, mine, local, current, transfers) {
    const files = (mine?.files ?? 0) + (local?.files ?? 0);
    const bytesNow = (mine ? sizeToBytes(mine.size) ?? 0 : 0) + (local?.bytes ?? 0);
    const sig = [mine?.files, mine?.size, local?.files, ...current.map((c) => `${c.tag}:${c.progress}:${c.state}`)].join("|");
    if (sig !== this.signature || this.lastChange < 0) {
      this.signature = sig;
      this.lastChange = now;
    }
    this.samples.push({ t: now, files, bytes: bytesNow });
    while (this.samples.length > 2 && now - this.samples[0].t > RATE_WINDOW_MS) this.samples.shift();
    const first = this.samples[0];
    const dt = now - first.t;
    const rate = dt >= 1e4 ? { filesPerMin: Math.max(0, (files - first.files) / dt * 6e4), bytesPerSec: Math.max(0, (bytesNow - first.bytes) / dt * 1e3) } : null;
    const active = current.find((c) => c.state === "ACTIVE") ?? current[0];
    const isLocalPath = (s) => /^([A-Za-z]:|[\\/][\\/][?.][\\/])/.test(s);
    const verb = !active ? "" : active.type.includes("\u21D1") ? "uploading" : active.type.includes("\u21D3") ? "downloading" : isLocalPath(active.source) ? "uploading" : isLocalPath(active.destination) ? "downloading" : "transferring";
    const cur = active ? `${verb} ${shortName(active.source)}${active.progress ? ` (${active.progress.replace(/\.\d+%$/, "%")})` : ""}` : null;
    const stalledMs = now - this.lastChange >= STALL_MS ? now - this.lastChange : 0;
    let stallReason = null;
    if (stalledMs) {
      const states = new Set(current.map((c) => c.state));
      if (states.has("RETRYING")) stallReason = "a transfer is RETRYING (MEGA or the network is refusing it for now)";
      else if (states.has("PAUSED") && !states.has("ACTIVE")) stallReason = "its transfers are PAUSED";
      else if (current.length && !states.has("ACTIVE")) stallReason = "its transfers are QUEUED, none is active";
      else if (!transfers || transfers.uploads + transfers.downloads === 0) stallReason = `the sync's status is ${mine?.status ?? "unknown"} with no transfer queued (MEGA's engine is scanning or comparing)`;
      else stallReason = `the sync's status is ${mine?.status ?? "unknown"}`;
    }
    return { rate, current: cur, stalledMs, stallReason };
  }
};
function count(n) {
  return Math.round(n).toLocaleString("en-US");
}
function bytes(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = i === 0 ? String(Math.round(v)) : v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}`;
}
var plural = (n, one) => `${count(n)} ${one}${n === 1 ? "" : "s"}`;
function queueText(p) {
  const parts = [];
  if (p.up) parts.push(`${plural(p.up, "file")} to upload`);
  if (p.down) parts.push(`${plural(p.down, "file")} to download`);
  if (parts.length && p.leftBytes) parts.push(`${bytes(p.leftBytes)} left`);
  return parts.join(", ");
}
function progressText(p, a = null) {
  const base = baseText(p);
  if (!a || p.kind === "synced") return base;
  const extra = [];
  let short = base.short;
  if (a.stalledMs) {
    const min = Math.floor(a.stalledMs / 6e4);
    short = `${short}, no progress ${min} min`;
    extra.push(`No progress for ${min} min: ${a.stallReason ?? "MEGAcmd gives no reason"}. See the log in the settings (MEGA-Route \u2192 Logs).`);
  } else if (a.rate && (a.rate.bytesPerSec >= 1 || a.rate.filesPerMin >= 1)) {
    if (a.rate.bytesPerSec >= 1024) short = `${short} \xB7 ${bytes(a.rate.bytesPerSec)}/s`;
    extra.push(`Rate over the last minute: ${a.rate.filesPerMin >= 1 ? `${count(a.rate.filesPerMin)} files/min, ` : ""}${bytes(a.rate.bytesPerSec)}/s.`);
  }
  if (a.current) extra.push(`Now ${a.current}.`);
  return { short, long: [base.long, ...extra].join(" "), fraction: base.fraction };
}
function baseText(p) {
  switch (p.kind) {
    case "synced":
      return {
        short: "synced",
        long: `In sync, 100%${p.files !== null ? `: ${plural(p.files, "file")}${p.bytes !== null ? `, ${bytes(p.bytes)}` : ""} on MEGA` : ""}.`,
        fraction: null
      };
    case "scanning": {
      const q = queueText(p);
      return { short: "scanning", long: `MEGA's sync engine is comparing the vault with MEGA${q ? `; ${q}` : ""}.`, fraction: null };
    }
    case "few": {
      const q = queueText(p);
      const first = p.up ? `${plural(p.up, "file")} to upload` : p.down ? `${plural(p.down, "file")} to download` : "working";
      return { short: `syncing: ${first}`, long: `Syncing${q ? `: ${q}` : ""}.`, fraction: null };
    }
    case "percent": {
      const q = queueText(p);
      const files = `${count(p.done)} of ${count(p.total)} files (${p.percent}%)`;
      const size = p.doneBytes !== null && p.totalBytes !== null ? `, ${bytes(p.doneBytes)} of ${bytes(p.totalBytes)}` : "";
      const approx = p.approximate ? " The file count is approximate (see the log)." : "";
      return { short: `syncing ${p.percent}%`, long: `Syncing: ${files}${size} in sync${q ? `; ${q}` : ""}.${approx}`, fraction: p.percent / 100 };
    }
  }
}

// src/core/status.ts
function emptyState() {
  return {
    checkedAt: 0,
    client: { path: null, found: false },
    server: "unknown",
    desktopApp: "unknown",
    account: { signedIn: null },
    syncs: [],
    mine: null,
    transfers: null,
    current: [],
    issues: [],
    error: null,
    operation: null
  };
}
var INSTALL_URL = "https://mega.io/cmd";
var NOT_INSTALLED_TIP = `MEGAcmd is not installed. Install it from ${INSTALL_URL}, then restart Obsidian or set MEGAcmd's folder in these settings.`;
var START_FIRST_TIP = "Start MEGAcmd first (Server: Start MEGAcmd). It may already be signed in.";
var SIGN_IN_FIRST_TIP = "Sign MEGAcmd in to your MEGA account first.";
function controls(s) {
  const on = { enabled: true, tip: null };
  const off = (tip) => ({ enabled: false, tip });
  if (!s.client.found) {
    const c = off(NOT_INSTALLED_TIP);
    return { start: c, stop: c, signIn: c, signOut: c, create: c, change: c };
  }
  if (s.operation) {
    const c = off(`${s.operation} is in progress: wait for it to finish.`);
    return { start: c, stop: c, signIn: c, signOut: c, create: c, change: c };
  }
  const running = s.server === "running";
  const startTip = s.server === "unknown" ? "Whether MEGAcmd runs could not be checked; press Refresh." : START_FIRST_TIP;
  return {
    start: s.server === "stopped" ? on : off(running ? "MEGAcmd is running." : startTip),
    stop: running ? on : off("MEGAcmd is not running."),
    signIn: !running ? off(startTip) : s.account.signedIn === true ? off("MEGAcmd is already signed in.") : on,
    signOut: !running ? off(startTip) : s.account.signedIn === true ? on : off("MEGAcmd is not signed in."),
    create: !running ? off(startTip) : s.account.signedIn !== true ? off(SIGN_IN_FIRST_TIP) : s.mine ? off("This vault already has a sync.") : on,
    change: !running ? off(startTip) : s.mine ? on : off("MEGAcmd has no sync of this vault.")
  };
}
function interruptedSignOut(s) {
  if (s.account.signedIn === null) return null;
  if (s.account.signedIn === false) return { finished: true, text: "The last sign-out finished: MEGAcmd is signed out." };
  const m = s.mine;
  const paused = !!m && (m.runState === "Disabled" || m.runState === "Suspended");
  const where = m ? paused ? "the sync is paused" : "the sync is running" : "there is no sync of this vault";
  return {
    finished: false,
    text: `The last sign-out did not finish (Obsidian closed or reloaded during it): MEGAcmd is still signed in and ${where}. Sign out again${paused ? ", or resume the sync" : ""}.`
  };
}
var BUSY_STATUS = /* @__PURE__ */ new Set(["Syncing", "Pending", "Processing"]);
function isBusy(s) {
  const m = s.mine;
  if (!m) return false;
  return BUSY_STATUS.has(m.status) || m.runState === "Loading" || m.runState === "Pending";
}
function describe(s, progress = null, activity = null) {
  const none = (level, short, long) => ({ level, short, long, progress: null });
  if (!s.client.found) return none("off", "MEGAcmd not found", `MEGAcmd was not found on this computer${s.client.reason ? ` (${s.client.reason})` : ""}. Install it from MEGA, or set its path in the settings.`);
  if (s.server === "unknown") return none("attention", "status unknown", s.error ?? "Whether MEGAcmd's server runs could not be checked.");
  if (s.server === "stopped") return none("off", "MEGAcmd not running", "MEGAcmd's server is not running, so no sync runs. Start it from this menu or the settings.");
  if (s.account.signedIn === false) return none("attention", "not signed in", "MEGAcmd is not signed in to a MEGA account. Sign in under Settings \u2192 MEGA-Route \u2192 Sign in to MEGA.");
  if (s.account.signedIn === null && s.error) return none("attention", "status unknown", s.error);
  const m = s.mine;
  if (!m) return none("off", "no sync", "MEGAcmd has no sync of this vault. Create one in the settings.");
  const where = `${m.localPath} \u2194 ${m.remotePath}`;
  if (m.error && m.error !== "NO" && !m.error.startsWith("Sync Issues")) {
    return none("error", `error: ${m.error}`, `The sync ${where} stopped with MEGA's error ${m.error}. See the log in the settings, and Troubleshooting in the plugin's documentation.`);
  }
  if (s.issues.length || m.error.startsWith("Sync Issues")) {
    const n = s.issues.length || Number(/\((\d+)\)/.exec(m.error)?.[1] ?? 0);
    const first = s.issues[0]?.reason;
    return none("attention", `${n} sync issue${n === 1 ? "" : "s"}`, `MEGA's sync engine stopped on ${n} item${n === 1 ? "" : "s"} it cannot decide alone${first ? ` (first: ${first})` : ""}. Run "sync-issues" in MEGAcmd to see and settle them.`);
  }
  if (m.runState === "Disabled" || m.runState === "Suspended") return none("paused", "paused", `The sync ${where} is paused (${m.runState}). Resume it from this menu or the settings.`);
  if (m.runState === "Pending" || m.runState === "Loading") return none("busy", "starting", `The sync ${where} is starting (${m.runState}).`);
  if (m.status === "Synced") {
    const t = progressText(progress ?? { kind: "synced", files: m.files, bytes: sizeToBytes(m.size) });
    return none("ok", "synced", `${where}: ${t.long}`);
  }
  if (BUSY_STATUS.has(m.status)) {
    const up = s.transfers?.uploads ?? 0;
    const down = s.transfers?.downloads ?? 0;
    const t = progressText(progress ?? { kind: up + down ? "few" : "scanning", up, down, leftBytes: null }, activity);
    return { level: "busy", short: t.short, long: `${where}: ${t.long}`, progress: t.fraction };
  }
  return none("busy", "checking", `The sync ${where} reports status ${m.status || "unknown"}.`);
}

// src/core/controller.ts
var TIMEOUT = {
  quick: 15e3,
  /** `version` may have to start MEGAcmd's server first. */
  start: 6e4,
  ls: 3e4,
  /** Adding a sync can take a while on a large folder. */
  add: 12e4,
  /** Signing in loads the account's file tree; and the user may have to find a two-factor code. */
  login: 18e4
};
var SIGN_OUT_QUEUE_MS = 5e3;
var CODE_TRIES = 3;
function classifyLogin(r, all, asked) {
  if (r.spawnError) return "failed";
  if (r.cancelled) return "code-cancelled";
  if (r.timedOut) return "timeout";
  if (r.code === 0) return "ok";
  if (/Already logged in/i.test(all) || r.code === MCMD.INVALIDSTATE) return "already";
  if (/incorrect authentication/i.test(all) || asked && r.code === 5) return "wrong-code";
  if (/invalid email or password/i.test(all) || r.code === 9) return "wrong-password";
  if (/unconfirmed account|confirm your account/i.test(all) || r.code === 13) return "unconfirmed";
  if (/Account blocked|suspended/i.test(all) || r.code === 16) return "blocked";
  if (/too many/i.test(all) || r.code === 6) return "too-many";
  if (r.code === 26) return "code-cancelled";
  if (/took too long/i.test(all)) return "timeout";
  return "failed";
}
var CODE_QUESTION = /Enter the code generated by your authentication app/i;
var LEGACY_NAMES = ["_mega_sync_snapshot.json", ".mega-sync-bin", ".mega-sync-conflicts"];
var Controller = class {
  constructor(env) {
    this.state = emptyState();
    this.busy = Promise.resolve();
    this.env = env;
    this.state.client = { path: env.clientPath, found: !!env.client, reason: env.clientProblem };
  }
  /** Runs MEGAcmd's client with `args`, logging the call and its result (not its output). */
  async mega(args, timeoutMs) {
    const c = this.env.client;
    if (!c) throw new Error("MEGAcmd was not found.");
    const r = await c.run(args, timeoutMs);
    const how = r.spawnError ? `not started (${r.spawnError})` : r.timedOut ? "timed out" : `exit ${r.code}`;
    this.env.log(r.code === 0 ? "debug" : "warn", redactText(`MEGAcmd ${args.join(" ")} \u2192 ${how} (${r.ms} ms)${r.code !== 0 && (r.stderr || r.stdout) ? `: ${firstLines(r.stderr || r.stdout)}` : ""}`));
    return r;
  }
  /** One call to MEGAcmd at a time: a status refresh waits for a running action, and the other way round. */
  serial(f) {
    const next = this.busy.then(f, f);
    this.busy = next.catch(() => void 0);
    return next;
  }
  /**
   * One action at a time (sign-in, sign-out, creating, pausing …): while one runs, another is refused at once, never
   * queued behind it (a sign-in queued behind a sign-out ran into it half-way). `state.operation` names the one running.
   */
  async exclusive(name, refuse, f) {
    if (this.state.operation) {
      const message = `${this.state.operation} is in progress: wait for it to finish, then try again.`;
      this.env.log("warn", `${name} refused: ${message}`);
      return refuse(message);
    }
    this.state.operation = name;
    try {
      return await this.serial(f);
    } finally {
      this.state.operation = null;
    }
  }
  /** Whether MEGAcmd's server and the MEGA desktop app are running. Never starts anything. */
  async probe() {
    const lister = this.env.processes;
    if (!lister) return { server: "unknown", desktopApp: "unknown" };
    const r = await lister.run([], TIMEOUT.quick);
    if (r.code !== 0) {
      this.env.log("warn", `Could not list running programs with ${lister.program} (${r.spawnError ?? (r.timedOut ? "timed out" : `exit ${r.code}`)}).`);
      return { server: "unknown", desktopApp: "unknown" };
    }
    const names = parseProcessNames(r.stdout, this.env.windows).map((n) => n.toLowerCase());
    const has = (list) => names.some((n) => list.includes(n));
    return { server: has(this.env.serverNames) ? "running" : "stopped", desktopApp: has(this.env.desktopAppNames) ? "running" : "not-running" };
  }
  /**
   * Brings `state` up to date. `full` also asks MEGAcmd's version and the signed-in account. MEGAcmd is asked nothing
   * while its server is not running, because its client would start the server (and with it any sync).
   */
  refresh(full) {
    return this.serial(() => this.doRefresh(full));
  }
  async doRefresh(full) {
    const s = this.state;
    s.checkedAt = Date.now();
    s.error = null;
    const p = await this.probe();
    s.desktopApp = p.desktopApp;
    if (!this.env.client) {
      s.server = "unknown";
      s.syncs = [];
      s.mine = null;
      s.transfers = null;
      s.issues = [];
      return s;
    }
    s.server = p.server;
    if (p.server !== "running") {
      s.account = { signedIn: null };
      s.syncs = [];
      s.mine = null;
      s.transfers = null;
      s.issues = [];
      if (p.server === "unknown") s.error = "Could not check whether MEGAcmd's server is running (the process list could not be read).";
      return s;
    }
    if (full || s.account.signedIn !== true) {
      if (!s.client.version) {
        const v = await this.mega(["version"], TIMEOUT.quick);
        if (v.code === 0) s.client.version = parseVersion(v.stdout);
      }
      const w = await this.mega(["whoami"], TIMEOUT.quick);
      const o = outcome(w, "whoami");
      if (o.kind === "ok") {
        const email = parseWhoami(w.stdout);
        s.account = { signedIn: true, masked: email ? maskEmail(email) : void 0 };
      } else if (o.kind === "not-logged-in") {
        s.account = { signedIn: false };
      } else {
        s.account = { signedIn: null };
        s.error = o.message;
        return s;
      }
    }
    if (!s.account.signedIn) {
      s.syncs = [];
      s.mine = null;
      s.transfers = null;
      s.issues = [];
      return s;
    }
    const list = await this.listSyncs();
    if (list === null) return s;
    s.syncs = list;
    s.mine = list.find((r) => sameLocal(r.localPath, this.env.vaultPath, this.env.windows)) ?? null;
    s.transfers = null;
    s.current = [];
    s.issues = [];
    if (s.mine && isBusy(s)) {
      const t = await this.mega(["transfers", "--summary"], TIMEOUT.quick);
      if (t.code === 0) s.transfers = parseTransferSummary(t.stdout);
      if (s.transfers && s.transfers.uploads + s.transfers.downloads > 0) {
        const c = await this.mega(["transfers", "--show-syncs", "--limit=3", "--path-display-size=4096", `--col-separator=${COL_SEP}`, `--output-cols=${TRANSFER_COLUMNS.join(",")}`], TIMEOUT.quick);
        if (c.code === 0) s.current = parseTransferList(c.stdout);
      }
    }
    if (s.mine && s.mine.error.startsWith("Sync Issues")) {
      const i = await this.mega(["sync-issues", "--limit=20", `--col-separator=${COL_SEP}`], TIMEOUT.quick);
      if (i.code === 0) s.issues = parseSyncIssues(i.stdout).filter((x) => !x.sync || x.sync === s.mine.id);
    }
    return s;
  }
  /** MEGAcmd's syncs, or null (with `state.error` set) when they could not be listed. */
  async listSyncs() {
    const r = await this.mega(["sync", "--path-display-size=4096", `--col-separator=${COL_SEP}`, `--output-cols=${SYNC_COLUMNS.join(",")}`], TIMEOUT.quick);
    const o = outcome(r, "Listing MEGAcmd's syncs");
    if (o.kind === "not-logged-in") {
      this.state.account = { signedIn: false };
      return [];
    }
    if (o.kind !== "ok") {
      this.state.error = o.message;
      return null;
    }
    const { rows, problems } = parseSyncList(r.stdout);
    for (const p of problems) this.env.log("warn", `MEGAcmd's sync list: ${p}`);
    return rows;
  }
  /** The `.megaignore` text the settings would write, and the patterns that could not be written as MEGA rules. */
  async ignorePreview(o) {
    const block = buildBlock(o);
    const existing = await this.env.readIgnore();
    const text = mergeIgnoreFile(existing, block.rules);
    return { text, problems: block.problems.map((p) => `"${p.pattern}" ${p.reason}`), changed: text !== existing };
  }
  /** Writes the plugin's block into `.megaignore` (only when it changed). */
  async writeIgnore(o) {
    const { text, problems, changed } = await this.ignorePreview(o);
    if (changed) {
      await this.env.writeIgnore(text);
      this.env.log("info", `Wrote the exclusions to .megaignore at the top of the vault (${buildBlock(o).rules.length} rules in MEGA-Route's block).`);
    }
    for (const p of problems) this.env.log("warn", `Exclusion not written: ${p}.`);
    return { written: changed, problems };
  }
  /** The checks before a sync is created. Nothing is changed. */
  planCreate(remoteInput, ignore) {
    return this.exclusive("Checking before creating the sync", (message) => ({ ok: false, local: this.env.vaultPath, remote: String(remoteInput), blockers: [message], warnings: [], remoteExists: false, remoteItems: [], remoteCount: 0, legacyItems: [], ignoreText: "", ignoreProblems: [] }), () => this.doPlanCreate(remoteInput, ignore));
  }
  async doPlanCreate(remoteInput, ignore) {
    const plan = { ok: false, local: this.env.vaultPath, remote: String(remoteInput), blockers: [], warnings: [], remoteExists: false, remoteItems: [], remoteCount: 0, legacyItems: [], ignoreText: "", ignoreProblems: [] };
    const remote = checkRemoteFolder(remoteInput);
    if (!remote.ok) plan.blockers.push(remote.reason);
    else plan.remote = remote.value;
    const local = checkLocalFolder(this.env.vaultPath, this.env.windows);
    if (!local.ok) plan.blockers.push(local.reason);
    if (!this.env.client) {
      plan.blockers.push(`MEGAcmd was not found${this.env.clientProblem ? ` (${this.env.clientProblem})` : ""}.`);
      return plan;
    }
    const p = await this.probe();
    this.state.server = p.server;
    this.state.desktopApp = p.desktopApp;
    if (p.server !== "running") {
      plan.blockers.push(p.server === "stopped" ? "MEGAcmd's server is not running: start it first." : "Could not check whether MEGAcmd's server is running.");
      return plan;
    }
    if (p.desktopApp === "running") {
      plan.warnings.push(
        "The MEGA desktop app (MEGAsync) is running. If it syncs or backs up this vault's folder, or a folder that contains it, two sync engines would work on the same files. Check its Settings \u2192 Sync and Backup, and remove such a sync there first (one engine per folder)."
      );
    }
    const w = await this.mega(["whoami"], TIMEOUT.quick);
    const wo = outcome(w, "whoami");
    if (wo.kind === "not-logged-in") {
      plan.blockers.push("MEGAcmd is not signed in to a MEGA account: sign in first.");
      return plan;
    }
    if (wo.kind !== "ok") {
      plan.blockers.push(wo.message);
      return plan;
    }
    const syncs = await this.listSyncs();
    if (syncs === null) {
      plan.blockers.push(this.state.error ?? "Could not list MEGAcmd's syncs.");
      return plan;
    }
    for (const r of syncs) {
      if (sameLocal(r.localPath, this.env.vaultPath, this.env.windows)) plan.blockers.push(`MEGAcmd already syncs this vault (sync ${r.id}, to ${r.remotePath}).`);
      else if (isInside(this.env.vaultPath, r.localPath, this.env.windows)) plan.blockers.push(`MEGAcmd already syncs a folder that contains the vault: ${r.localPath} (sync ${r.id}).`);
      else if (isInside(r.localPath, this.env.vaultPath, this.env.windows)) plan.blockers.push(`MEGAcmd already syncs a folder inside the vault: ${r.localPath} (sync ${r.id}).`);
      if (remote.ok && (sameRemote(r.remotePath, remote.value) || isRemoteInside(r.remotePath, remote.value) || isRemoteInside(remote.value, r.remotePath))) {
        plan.blockers.push(`The MEGA folder ${remote.value} is already in another of MEGAcmd's syncs: ${r.localPath} \u2194 ${r.remotePath} (sync ${r.id}).`);
      }
    }
    if (remote.ok) {
      const ls = await this.mega(["ls", remote.value], TIMEOUT.ls);
      const lo = outcome(ls, `Looking at ${remote.value} on MEGA`);
      if (lo.kind === "ok") {
        plan.remoteExists = true;
        const names = parseLs(ls.stdout, remote.value);
        plan.remoteCount = names.length;
        plan.remoteItems = names.slice(0, 50);
        plan.legacyItems = names.filter((n) => LEGACY_NAMES.includes(n));
        if (names.length) {
          plan.warnings.push(
            `${remote.value} on MEGA is not empty (${names.length} item${names.length === 1 ? "" : "s"} at its top). MEGA's sync engine will merge it with the vault: files only on MEGA are downloaded into the vault, files only in the vault are uploaded, and a file that differs on the two sides may be reported as a sync issue for you to settle.`
          );
        }
        if (plan.legacyItems.length) {
          plan.warnings.push(`${plan.legacyItems.join(", ")} in ${remote.value} were left by MEGA-Route 2.x; the exclusions keep them out of the vault.`);
        }
      } else if (lo.kind === "not-found") {
        plan.blockers.push(`${remote.value} does not exist on MEGA. Create it first (the button in the dialog, or in MEGA's apps).`);
      } else {
        plan.blockers.push(lo.message);
      }
    }
    try {
      const preview = await this.ignorePreview(ignore);
      plan.ignoreText = preview.text;
      plan.ignoreProblems = preview.problems;
      if (preview.problems.length) plan.warnings.push(`${preview.problems.length} exclusion pattern${preview.problems.length === 1 ? "" : "s"} cannot be written as MEGA rules and will not apply: ${preview.problems.join("; ")}.`);
    } catch (e) {
      plan.blockers.push(`The exclusions could not be prepared: ${e instanceof Error ? e.message : String(e)}`);
    }
    plan.ok = plan.blockers.length === 0;
    return plan;
  }
  /** Creates the sync from a plan that passed: writes the exclusions first, then `sync <vault> <MEGA folder>`. */
  create(plan, ignore) {
    return this.exclusive("Creating the sync", (message) => ({ ok: false, message }), async () => {
      if (!plan.ok) return { ok: false, message: "The checks did not pass." };
      const remote = checkRemoteFolder(plan.remote);
      const local = checkLocalFolder(this.env.vaultPath, this.env.windows);
      if (!remote.ok) return { ok: false, message: remote.reason };
      if (!local.ok) return { ok: false, message: local.reason };
      if (!sameLocal(plan.local, local.value, this.env.windows)) return { ok: false, message: "The vault's folder changed since the checks." };
      try {
        await this.writeIgnore(ignore);
      } catch (e) {
        return { ok: false, message: `The exclusions could not be written to .megaignore, so no sync was created: ${e instanceof Error ? e.message : String(e)}` };
      }
      const r = await this.mega(["sync", local.value, remote.value], TIMEOUT.add);
      const o = outcome(r, `Creating the sync ${local.value} \u2194 ${remote.value}`);
      if (o.kind !== "ok") return { ok: false, message: o.message };
      const added = /Added sync:.*/.exec(r.stdout)?.[0] ?? "Added the sync.";
      const warning = /Sync added as temporarily disabled.*/.exec(r.stderr + "\n" + r.stdout)?.[0];
      this.env.log(warning ? "warn" : "info", `${added}${warning ? ` ${warning}` : ""}`);
      await this.doRefresh(false);
      return { ok: true, message: warning ? `${added} ${warning}` : added };
    });
  }
  /** Creates the MEGA folder (and any missing parents) with `mkdir -p`. */
  makeRemoteFolder(remoteInput) {
    return this.exclusive("Creating the MEGA folder", (message) => ({ ok: false, message }), async () => {
      const remote = checkRemoteFolder(remoteInput);
      if (!remote.ok) return { ok: false, message: remote.reason };
      const r = await this.mega(["mkdir", "-p", remote.value], TIMEOUT.quick);
      const o = outcome(r, `Creating ${remote.value} on MEGA`);
      if (o.kind === "ok") {
        this.env.log("info", `Created ${remote.value} on MEGA.`);
        return { ok: true, message: `Created ${remote.value} on MEGA.` };
      }
      return { ok: false, message: o.message };
    });
  }
  /** Pauses, resumes or removes (the configuration only, never the files) the vault's sync. */
  change(action) {
    const label = action === "pause" ? "Pausing the sync" : action === "resume" ? "Resuming the sync" : "Removing the sync";
    return this.exclusive(label, (message) => ({ ok: false, message }), async () => {
      const mine = this.state.mine;
      if (!mine) return { ok: false, message: "MEGAcmd has no sync of this vault." };
      const id = checkSyncId(mine.id);
      const byFolder = checkLocalFolder(this.env.vaultPath, this.env.windows);
      const target = id.ok ? id.value : byFolder.ok ? byFolder.value : null;
      if (target === null) return { ok: false, message: `${id.ok ? "" : id.reason} ${byFolder.ok ? "" : byFolder.reason}`.trim() };
      const flag = action === "pause" ? "-p" : action === "resume" ? "-e" : "-d";
      const r = await this.mega(["sync", flag, target], TIMEOUT.quick);
      const what = action === "pause" ? "Pausing" : action === "resume" ? "Resuming" : "Removing";
      const o = outcome(r, `${what} the sync ${mine.id}`);
      if (o.kind !== "ok") return { ok: false, message: o.message };
      const done = action === "pause" ? "Paused" : action === "resume" ? "Resumed" : "Removed";
      this.env.log("info", `${done} the sync ${mine.id} (${mine.localPath} \u2194 ${mine.remotePath})${action === "remove" ? "; no file was deleted" : ""}.`);
      await this.doRefresh(false);
      return { ok: true, message: `${done} the sync.` };
    });
  }
  /**
   * Signs MEGAcmd in to a MEGA account: `login <email> <password>`, the only form MEGAcmd's scriptable client accepts
   * (`login <email>` alone is refused outside MEGAcmd's interactive shell, which needs a console window). When MEGAcmd
   * asks for a two-factor code, the code is asked of the user and written to MEGAcmd's input, never put on a command
   * line. The password and code are checked first, kept only for the call, and taken out of every message and log line.
   * Never run while MEGAcmd's server is stopped: the user starts it first (it may already hold a session).
   */
  signIn(emailIn, passwordIn, ui) {
    return this.exclusive("Signing in", (message) => ({ ok: false, kind: "busy", message }), async () => {
      const secrets = [];
      const result = (ok, kind, message) => ({ ok, kind, message: redactText(message, secrets) });
      try {
        const email = checkEmail(emailIn);
        if (!email.ok) return result(false, "refused", email.reason);
        const password = checkPassword(passwordIn);
        if (!password.ok) return result(false, "refused", password.reason);
        secrets.push(password.value, email.value);
        let early = null;
        if (ui.code !== void 0 && ui.code.trim() !== "") {
          const c = checkCode(ui.code);
          if (!c.ok) return result(false, "refused", "The one-time code is the six digits from your authenticator app. Leave it empty if two-factor authentication is off for your account.");
          early = c.value;
          secrets.push(early);
        }
        const client = this.env.client;
        if (!client) return result(false, "not-found", `MEGAcmd was not found${this.env.clientProblem ? ` (${this.env.clientProblem})` : ""}. Install it from https://mega.io/cmd.`);
        if (!client.runInteractive) return result(false, "failed", "This MEGAcmd runner cannot sign in.");
        const p = await this.probe();
        this.state.server = p.server;
        if (p.server !== "running") return result(false, "server-stopped", "Start MEGAcmd first (Settings \u2192 MEGA-Route \u2192 Server \u2192 Start MEGAcmd); it may already be signed in.");
        const who = maskEmail(email.value);
        this.env.log("info", `Signing MEGAcmd in as ${who} (MEGAcmd login; the password is passed to MEGAcmd's client only).`);
        let res = null;
        let pending = early;
        for (let attempt = 1; res === null; attempt++) {
          let asked = false;
          const r = await client.runInteractive(["login", email.value, password.value], TIMEOUT.login, (out, io) => {
            if (asked || !CODE_QUESTION.test(out)) return;
            asked = true;
            const send = (raw) => {
              const code = raw === null ? null : checkCode(raw);
              if (!code || !code.ok) return io.cancel();
              secrets.push(code.value);
              io.reply(code.value);
            };
            if (pending !== null) {
              send(pending);
              pending = null;
              return;
            }
            this.env.log("info", "MEGAcmd asks for the two-factor code from your authenticator app.");
            ui.askCode({ attempt, of: CODE_TRIES }).then(send, () => io.cancel());
          });
          const text = redactText(firstLines(`${r.stderr}
${r.stdout}`.replace(CODE_QUESTION, "").replace(/^[\s:]+/, "")), secrets);
          this.env.log(r.code === 0 ? "debug" : "warn", redactText(`MEGAcmd login ${who} [password] \u2192 ${r.spawnError ? `not started (${r.spawnError})` : r.timedOut ? "timed out" : r.cancelled ? "stopped" : `exit ${r.code}`} (${r.ms} ms)${r.code !== 0 && text ? `: ${text}` : ""}`, secrets));
          const all = `${r.stderr}
${r.stdout}`;
          const kind = classifyLogin(r, all, asked);
          if (kind === "wrong-code" && attempt < CODE_TRIES) {
            this.env.log("info", `The two-factor code was not accepted (wrong, or expired); asking for the next one (${attempt + 1} of ${CODE_TRIES}).`);
            const next = await ui.askCode({ attempt: attempt + 1, of: CODE_TRIES, retry: true }).catch(() => null);
            if (next === null || !checkCode(next).ok) res = result(false, "code-cancelled", "Sign-in stopped: no two-factor code was given. Press Sign in again when you have your authenticator app.");
            else pending = next;
            continue;
          }
          const blockedReason = /Reason:\s*(.*)$/m.exec(all)?.[1]?.trim();
          const messages = {
            ok: `MEGAcmd is signed in as ${who}.`,
            already: "MEGAcmd is already signed in (to sign in to another account, run logout in MEGAcmd first; that also removes its syncs).",
            "wrong-password": "MEGA did not accept that email and password. Check them (the email is the one you sign in to MEGA with) and try again.",
            "wrong-code": `The two-factor code was not accepted ${CODE_TRIES} times (a code is wrong, or expired once the app shows the next one). Check your authenticator app's clock, then sign in again.`,
            "code-cancelled": "Sign-in stopped: no two-factor code was given. Press Sign in again when you have your authenticator app.",
            unconfirmed: "This MEGA account is not confirmed yet: open the confirmation email MEGA sent you, then sign in again.",
            blocked: `MEGA has suspended the account until it is verified${blockedReason ? `: ${blockedReason}` : ""}. Verify it as MEGA asks (the email MEGA sent, or MEGA's web app at mega.nz), then sign in again here.`,
            "too-many": "MEGA refuses sign-ins for this account for now: too many attempts. Wait a while (MEGA does not say how long) and try again.",
            timeout: r.timedOut ? "MEGAcmd did not finish signing in within 3 minutes. It may still finish: press Refresh in a minute. If it stays signed out, try again." : "MEGAcmd says the sign-in took too long and may have failed. Press Refresh in a minute; if it stays signed out, try again.",
            "server-stopped": "",
            "not-found": "",
            refused: "",
            busy: "",
            failed: r.spawnError ? `MEGAcmd could not be started (${r.spawnError}).` : `MEGAcmd could not sign in (code ${r.code})${text ? `: ${text}` : ""}.`
          };
          res = result(kind === "ok" || kind === "already", kind, messages[kind]);
        }
        ui.done();
        this.env.log(res.ok ? "info" : "warn", res.message);
        if (res.ok) this.state.account = { signedIn: true, masked: res.kind === "ok" ? who : this.state.account.masked };
        await this.doRefresh(!res.ok);
        return res;
      } finally {
        secrets.length = 0;
      }
    });
  }
  /**
   * Signs MEGAcmd out of MEGA, completely, in steps that are each checked before the next, reporting each as it starts:
   *   1. pause the vault's sync (`sync -p`): the sync's own transfers stop with it, and no new one starts;
   *   2. stop the other transfers: `transfers` without --show-syncs lists exactly those that are not a sync's (only
   *      QUEUED, ACTIVE, PAUSED, RETRYING or COMPLETING count). Usually there are none and nothing more is asked; else
   *      `transfers -c -a` cancels them (the MEGA SDK's cancelTransfers cancels only non-sync transfers: "Marked all
   *      non-sync non-streaming transfers as cancelled", src/megaapi_impl.cpp, which is why 3.0.6, waiting for the whole
   *      queue to empty, waited its full 15 s), and the list is checked every 250 ms for up to SIGN_OUT_QUEUE_MS;
   *   3. `logout` (never `--keep-session`, which keeps the session for the next start and prints the session id):
   *      MEGA ends the session, and MEGAcmd deletes its saved session and its local cache, its syncs included;
   *   4. done: logout's exit code is the check (MEGAcmd sets it from MEGA's answer); no whoami after it. The next
   *      status check asks MEGAcmd as usual.
   * A step that fails stops the sign-out, and the message says which step and the state things are in.
   */
  signOut(onStep = () => void 0) {
    return this.exclusive("Signing out", (message) => ({ ok: false, message }), async () => {
      if (!this.env.client) return { ok: false, message: "MEGAcmd was not found." };
      const started = Date.now();
      const timing = [];
      let t0 = Date.now();
      const STEPS = 3;
      const step = (n, text) => {
        if (n > 1) timing.push(`${n - 1}: ${Date.now() - t0} ms`);
        t0 = Date.now();
        onStep(n, STEPS, text);
      };
      const p = await this.probe();
      if (p.server !== "running") return { ok: false, message: "MEGAcmd's server is not running: start it first." };
      const who = this.state.account.masked ?? "this account";
      const fail = (n, what, why, state) => {
        const message = `Sign-out stopped at step ${n} of ${STEPS} (${what}): ${why.replace(/[.\s]*$/, ".")} State: ${state}`;
        this.env.log("error", message);
        return { ok: false, message, step: n };
      };
      this.env.log("info", `Signing MEGAcmd out of MEGA (${who}).`);
      step(1, "pausing the sync");
      const mine = this.state.mine;
      if (mine && mine.runState !== "Disabled" && mine.runState !== "Suspended") {
        const id = checkSyncId(mine.id);
        const folder = checkLocalFolder(this.env.vaultPath, this.env.windows);
        const target = id.ok ? id.value : folder.ok ? folder.value : null;
        if (target === null) return fail(1, "pausing the sync", "the sync could not be named safely.", "nothing was changed.");
        const r = await this.mega(["sync", "-p", target], TIMEOUT.quick);
        const o = outcome(r, "Pausing the sync");
        if (o.kind !== "ok") return fail(1, "pausing the sync", o.message, "nothing was changed; MEGAcmd is still signed in.");
        this.env.log("info", `Sign-out 1/${STEPS}: the sync is paused (its transfers stop with it).`);
      } else {
        this.env.log("info", mine ? `Sign-out 1/${STEPS}: the sync was already paused.` : `Sign-out 1/${STEPS}: no sync of this vault to pause.`);
      }
      const paused = mine ? "the sync is paused" : "there is no sync of this vault";
      step(2, "stopping other transfers");
      const liveOthers = async () => {
        const t = await this.mega(["transfers", "--limit=1000", "--path-display-size=1", `--col-separator=${COL_SEP}`, `--output-cols=${TRANSFER_COLUMNS.join(",")}`], TIMEOUT.quick);
        return t.code === 0 ? parseTransferList(t.stdout).filter((x) => LIVE_TRANSFER_STATES.has(x.state)) : null;
      };
      let live = await liveOthers();
      if (live === null || live.length > 0) {
        const c = await this.mega(["transfers", "-c", "-a"], TIMEOUT.quick);
        const co = outcome(c, "Cancelling the transfers");
        if (co.kind !== "ok") return fail(2, "stopping other transfers", co.message, `${paused}; MEGAcmd is still signed in. Resume the sync in the settings, or sign out again.`);
        const until = Date.now() + SIGN_OUT_QUEUE_MS;
        for (; ; ) {
          live = await liveOthers();
          if (live && live.length === 0) break;
          if (Date.now() >= until) {
            const left = live ? `${live.length} transfer(s) are still ${[...new Set(live.map((x) => x.state.toLowerCase()))].join(" or ")}` : "MEGAcmd's list of transfers could not be read";
            return fail(2, "stopping other transfers", `${left} after ${Math.round(SIGN_OUT_QUEUE_MS / 1e3)} s.`, `${paused}; MEGAcmd is still signed in. Sign out again in a moment, or resume the sync.`);
          }
          await new Promise((res) => setTimeout(res, 250));
        }
        this.env.log("info", `Sign-out 2/${STEPS}: other transfers cancelled.`);
      } else {
        this.env.log("info", `Sign-out 2/${STEPS}: no other transfer running.`);
      }
      step(3, "signing MEGAcmd out");
      const l = await this.mega(["logout"], TIMEOUT.quick);
      const lo = outcome(l, "Signing out");
      if (lo.kind !== "ok" && lo.kind !== "not-logged-in") return fail(3, "signing MEGAcmd out", lo.message, `${paused}; MEGAcmd may still be signed in. Sign out again, or resume the sync.`);
      timing.push(`3: ${Date.now() - t0} ms`);
      this.state.account = { signedIn: false };
      this.state.syncs = [];
      this.state.mine = null;
      this.state.transfers = null;
      this.state.current = [];
      this.state.issues = [];
      this.env.log("info", `Sign-out 3/${STEPS}: MEGAcmd signed out (its saved session and syncs are deleted). Took ${Date.now() - started} ms (probe and steps ${timing.join(", ")}).`);
      return { ok: true, message: "Signed out of MEGA. MEGAcmd's session and its sync of this vault are removed; the files on both sides are untouched." };
    });
  }
  /** Starts MEGAcmd's server: its client starts it when asked anything, so it is asked its version. */
  startServer() {
    return this.exclusive("Starting MEGAcmd", (message) => ({ ok: false, message }), async () => {
      if (!this.env.client) return { ok: false, message: "MEGAcmd was not found." };
      this.env.log("info", "Starting MEGAcmd's server (its client starts it when asked for its version).");
      const r = await this.mega(["version"], TIMEOUT.start);
      const o = outcome(r, "Starting MEGAcmd");
      await this.doRefresh(true);
      return o.kind === "ok" ? { ok: true, message: "MEGAcmd's server is running." } : { ok: false, message: o.message };
    });
  }
  /** Stops MEGAcmd's server (`quit`); its syncs stop until it is started again. */
  stopServer() {
    return this.exclusive("Stopping MEGAcmd", (message) => ({ ok: false, message }), async () => {
      if (!this.env.client) return { ok: false, message: "MEGAcmd was not found." };
      const r = await this.mega(["quit"], TIMEOUT.quick);
      const o = outcome(r, "Stopping MEGAcmd");
      this.env.log("info", "Asked MEGAcmd's server to stop.");
      await this.doRefresh(false);
      return o.kind === "ok" ? { ok: true, message: "MEGAcmd's server was asked to stop." } : { ok: false, message: o.message };
    });
  }
};

// src/core/log.ts
var LogBuffer = class {
  constructor(capacity = 2e3) {
    this.lines = [];
    this.listeners = /* @__PURE__ */ new Set();
    this.capacity = Math.max(10, capacity);
  }
  add(source, level, text, t = Date.now()) {
    const added = text.split(/\r?\n/).filter((l) => l.length > 0).map((l) => ({ t, source, level, text: l.length > 4e3 ? l.slice(0, 4e3) + " \u2026" : l }));
    if (!added.length) return;
    this.lines.push(...added);
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
    for (const f of this.listeners) {
      try {
        f(added);
      } catch {
      }
    }
  }
  all() {
    return this.lines;
  }
  clear() {
    this.lines.length = 0;
  }
  subscribe(f) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
};
function formatLine(l, withDate = false) {
  const d = new Date(l.t);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const time = withDate ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const tag = l.source === "plugin" ? "MEGA-Route" : "MEGAcmd";
  const lvl = l.level === "info" ? "" : ` ${l.level.toUpperCase()}`;
  return `${time} [${tag}${lvl}] ${l.text}`;
}
var LogTail = class {
  constructor(fs, path, initialBytes = 64 * 1024, maxBytesPerPoll = 512 * 1024) {
    this.offset = -1;
    this.ino = -1;
    this.rest = "";
    this.dropNext = false;
    this.fs = fs;
    this.path = path;
    this.initialBytes = initialBytes;
    this.maxBytesPerPoll = maxBytesPerPoll;
  }
  /** Lines added since the last poll; `missing` when the file does not exist (yet). */
  async poll() {
    let st;
    try {
      st = await this.fs.stat(this.path);
    } catch {
      return { lines: [], missing: true, skipped: 0, restarted: false };
    }
    let restarted = false;
    let dropFirst = false;
    if (this.offset < 0) {
      this.offset = Math.max(0, st.size - this.initialBytes);
      dropFirst = this.offset > 0;
      this.ino = st.ino;
      this.rest = "";
    } else if (st.size < this.offset || st.ino !== 0 && this.ino !== 0 && st.ino !== this.ino) {
      this.offset = 0;
      this.ino = st.ino;
      this.rest = "";
      restarted = true;
    }
    let skipped = 0;
    if (st.size - this.offset > this.maxBytesPerPoll) {
      skipped = st.size - this.maxBytesPerPoll - this.offset;
      this.offset = st.size - this.maxBytesPerPoll;
      this.rest = "";
      dropFirst = true;
    }
    const length = st.size - this.offset;
    if (length <= 0) return { lines: [], missing: false, skipped, restarted };
    const buf = new Uint8Array(length);
    const fh = await this.fs.open(this.path, "r");
    let read = 0;
    try {
      while (read < length) {
        const { bytesRead } = await fh.read(buf, read, length - read, this.offset + read);
        if (bytesRead <= 0) break;
        read += bytesRead;
      }
    } finally {
      await fh.close();
    }
    this.offset += read;
    const text = this.rest + new TextDecoder("utf-8").decode(buf.subarray(0, read));
    const parts = text.split(/\r?\n/);
    this.rest = parts.pop() ?? "";
    if (dropFirst || this.dropNext) {
      this.dropNext = parts.length === 0;
      parts.shift();
    }
    if (this.rest.length > 64 * 1024) this.rest = this.rest.slice(-64 * 1024);
    return { lines: parts.filter((l) => l.length > 0), missing: false, skipped, restarted };
  }
};
function wrapClasses(wrap) {
  return wrap ? { add: "is-wrap", remove: "is-nowrap" } : { add: "is-nowrap", remove: "is-wrap" };
}
var SYNC_LINE = /sync|transfer|upload|download|putnodes|debris|stall|conflict|megaignore|scan/i;

// src/core/logfile.ts
var MAX_BYTES = 1024 * 1024;
var LogFile = class {
  constructor(fs, path, maxBytes = MAX_BYTES) {
    this.pending = [];
    this.writing = false;
    this.fs = fs;
    this.path = path;
    this.maxBytes = maxBytes;
  }
  add(line) {
    this.pending.push(line);
    if (this.pending.length > 5e3) this.pending.splice(0, this.pending.length - 5e3);
  }
  /** Writes what was added since the last flush. Failures are returned, not thrown (the log must never break the plugin). */
  async flush() {
    if (this.writing || this.pending.length === 0) return null;
    this.writing = true;
    const lines = this.pending.splice(0);
    try {
      try {
        const st = await this.fs.stat(this.path);
        if (st.size > this.maxBytes) {
          const old = this.path.replace(/\.log$/, ".1.log");
          await this.fs.rm(old, { force: true });
          await this.fs.rename(this.path, old);
        }
      } catch {
      }
      await this.fs.appendFile(this.path, lines.join("\n") + "\n", "utf8");
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      this.writing = false;
    }
  }
};

// src/core/locate.ts
function join(os, ...parts) {
  const sep = os === "windows" ? "\\" : "/";
  return parts.map((p, i) => i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")).filter((p) => p !== "").join(sep);
}
function dirname(os, p) {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : os === "windows" ? p : "/";
}
function basename(p) {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i >= 0 ? p.slice(i + 1) : p;
}
function clientNames(os) {
  return os === "windows" ? ["megaclient.exe"] : ["mega-exec"];
}
function defaultClient(p) {
  if (p.os === "windows") {
    const base = p.env.LOCALAPPDATA;
    return base ? join("windows", base, "MEGAcmd", "MegaClient.exe") : null;
  }
  if (p.os === "macos") return "/Applications/MEGAcmd.app/Contents/MacOS/mega-exec";
  return "/usr/bin/mega-exec";
}
function pathsFor(p, client) {
  if (p.os === "windows") {
    const dir = dirname("windows", client);
    return { client, log: join("windows", dir, ".megaCmd", "megacmdserver.log") };
  }
  return { client, log: join(p.os, p.home, ".megaCmd", "megacmdserver.log") };
}
function serverProcessNames(os) {
  return os === "windows" ? ["megacmdserver.exe"] : ["mega-cmd-server", "megacmdserver", "megacmdloader"];
}
function desktopAppProcessNames(os) {
  return os === "windows" ? ["megasync.exe"] : ["megasync"];
}
function processLister(p) {
  if (p.os === "windows") {
    const root = p.env.SystemRoot || p.env.windir || p.env.WINDIR;
    if (!root || !/^[A-Za-z]:\\/.test(root)) return null;
    return { program: join("windows", root, "System32", "tasklist.exe"), args: ["/FI", "IMAGENAME eq MEGA*", "/FO", "CSV", "/NH"] };
  }
  return { program: "/bin/ps", args: ["-A", "-o", "comm="] };
}
async function checkClientPath(p, input, vaultPath, stat) {
  let path = input.trim();
  if (!path) return { ok: false, reason: "No path is set for MEGAcmd." };
  if (/[\u0000-\u001f"]/.test(path)) return { ok: false, reason: "The path contains a control character or a quotation mark." };
  const absolute = p.os === "windows" ? /^[A-Za-z]:\\/.test(path) : path.startsWith("/");
  if (!absolute) return { ok: false, reason: `Not an absolute path: ${path}` };
  try {
    const st = await stat(path);
    if (st.isDirectory?.()) {
      if (p.os === "windows") path = join(p.os, path, "MegaClient.exe");
      else if (p.os === "macos" && /\.app\/?$/.test(path)) path = join(p.os, path, "Contents", "MacOS", "mega-exec");
      else path = join(p.os, path, "mega-exec");
    }
  } catch {
  }
  const name = basename(path);
  const allowed = clientNames(p.os);
  if (!allowed.includes(p.os === "windows" ? name.toLowerCase() : name)) {
    return { ok: false, reason: `The file must be MEGAcmd's client program (${p.os === "windows" ? "MegaClient.exe" : "mega-exec"}), not ${name}.` };
  }
  const lower = (s) => p.os === "windows" ? s.toLowerCase().replace(/\//g, "\\") : s;
  const v = lower(vaultPath).replace(/[\\/]+$/, "");
  if (v && (lower(path) + (p.os === "windows" ? "\\" : "/")).startsWith(v + (p.os === "windows" ? "\\" : "/"))) {
    return { ok: false, reason: "MEGAcmd must not be run from inside the vault." };
  }
  try {
    const st = await stat(path);
    if (!st.isFile()) return { ok: false, reason: `Not a file: ${path}` };
  } catch {
    return { ok: false, reason: `Not found: ${path}` };
  }
  return { ok: true, path };
}

// src/core/runner.ts
var MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
function safeEnv(env) {
  if (!env) return void 0;
  const out = {};
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() !== "MEGACMD_DO_NOT_REDACT_LINES") out[k] = v;
  return out;
}
var ProcessRunner = class {
  /**
   * @param cp Node's child_process (or a stand-in).
   * @param program The program's absolute path.
   * @param prefix Arguments put before every call's own (the tests run a script with Node this way).
   * @param env The environment (MEGACMD_DO_NOT_REDACT_LINES taken out); Node's own when undefined.
   */
  constructor(cp, program, prefix = [], env) {
    this.cp = cp;
    this.program = program;
    this.prefix = prefix;
    this.env = safeEnv(env);
  }
  run(args, timeoutMs) {
    const started = Date.now();
    return new Promise((resolve) => {
      try {
        this.cp.execFile(
          this.program,
          [...this.prefix, ...args],
          { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8", env: this.env },
          (error, stdout, stderr) => {
            const ms = Date.now() - started;
            const out = typeof stdout === "string" ? stdout : "";
            const err = typeof stderr === "string" ? stderr : "";
            if (!error) return resolve({ code: 0, stdout: out, stderr: err, timedOut: false, ms });
            if (typeof error.code === "number") return resolve({ code: error.code, stdout: out, stderr: err, timedOut: false, ms });
            if (error.killed || error.signal) return resolve({ code: -1, stdout: out, stderr: err, timedOut: true, ms });
            resolve({ code: -1, stdout: out, stderr: err, timedOut: false, spawnError: String(error.code ?? error.message), ms });
          }
        );
      } catch (e) {
        resolve({ code: -1, stdout: "", stderr: "", timedOut: false, spawnError: e instanceof Error ? e.message : String(e), ms: Date.now() - started });
      }
    });
  }
  runInteractive(args, timeoutMs, onOutput) {
    const started = Date.now();
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let cancelled = false;
      let done = false;
      let child;
      const finish = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ...r, stdout, stderr, ms: Date.now() - started });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child?.kill();
        } catch {
        }
      }, timeoutMs);
      try {
        child = this.cp.spawn(this.program, [...this.prefix, ...args], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: this.env });
      } catch (e) {
        finish({ code: -1, timedOut: false, spawnError: e instanceof Error ? e.message : String(e) });
        return;
      }
      const io = {
        reply: (line) => {
          try {
            child.stdin?.write(line + "\n");
          } catch {
          }
        },
        cancel: () => {
          cancelled = true;
          try {
            child.kill();
          } catch {
          }
        }
      };
      child.stdin?.on("error", () => void 0);
      child.stdout?.on("data", (c) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += String(c);
        try {
          onOutput(stdout, io);
        } catch {
          io.cancel();
        }
      });
      child.stderr?.on("data", (c) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += String(c);
      });
      child.on("error", (e) => finish({ code: -1, timedOut: false, spawnError: e.message }));
      child.on("close", (code) => {
        if (timedOut) finish({ code: -1, timedOut: true });
        else if (cancelled) finish({ code: -1, timedOut: false, cancelled: true });
        else finish({ code: typeof code === "number" ? code : -1, timedOut: false });
      });
    });
  }
};

// src/core/fsio.ts
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
async function writeInPlace(fs, path, text) {
  const bytes2 = new TextEncoder().encode(text);
  let fh;
  try {
    fh = await fs.open(path, "r+");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    fh = await fs.open(path, "wx");
  }
  try {
    let done = 0;
    while (done < bytes2.length) {
      const { bytesWritten } = await fh.write(bytes2, done, bytes2.length - done, done);
      if (bytesWritten <= 0) throw new Error(`writing stopped after ${done} of ${bytes2.length} bytes`);
      done += bytesWritten;
    }
    await fh.truncate(bytes2.length);
    await fh.datasync();
  } finally {
    await fh.close();
  }
  const back = await fs.readFile(path);
  if (!sameBytes(new Uint8Array(back), bytes2)) throw new Error(`${path} does not hold what was written (read back ${back.length} bytes, wrote ${bytes2.length})`);
}
function writeFailure(path, e) {
  const code = e.code;
  const why = e instanceof Error ? e.message : String(e);
  const what = code === "EPERM" || code === "EACCES" ? "Windows refused to change it. Check that no other program holds it open or has made it read-only (right-click \u2192 Properties: Read-only unticked), and that your account may change files in the vault; then try again." : code === "EBUSY" ? "Another program is using it (the MEGA desktop app or an antivirus may be scanning it). Wait a moment and try again." : code === "ENOSPC" ? "The disk is full." : "See the log for details.";
  return `Could not write ${path}: ${why}. ${what}`;
}

// src/core/coverage.ts
var UNIT = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
function parseRules(text) {
  const out = { rules: [], largerThan: null, smallerThan: null, syncIgnoreFile: false, approximate: [] };
  if (text === null) return out;
  for (const raw of (text.charCodeAt(0) === 65279 ? text.slice(1) : text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.startsWith("#")) continue;
    if (/^[+-]sync:\.megaignore$/.test(line)) {
      out.syncIgnoreFile = line.startsWith("+");
      continue;
    }
    const size = /^exclude-(larger|smaller):\s*(\d+)\s*([kmgt]?)$/i.exec(line);
    if (size) {
      const bytes2 = Number(size[2]) * UNIT[size[3].toLowerCase()];
      if (size[1].toLowerCase() === "larger") out.largerThan = bytes2;
      else out.smallerThan = bytes2;
      if (!out.approximate.includes("size limits")) out.approximate.push("size limits (MEGA applies them only to files not yet synced)");
      continue;
    }
    const m = /^([+-])([adfs]?)([Nnp]?)([GgRr]?):(.*)$/.exec(line);
    if (!m) {
      out.approximate.push(`a line MEGA would not accept (it stops the sync of that folder): ${line.slice(0, 60)}`);
      continue;
    }
    const pattern = m[5];
    const rule = {
      include: m[1] === "+",
      target: m[2] || "a",
      type: m[3] || (pattern.includes("/") ? "p" : "n"),
      regex: m[4] === "r" || m[4] === "R",
      caseSensitive: m[4] === "G" || m[4] === "R",
      pattern
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
function wildcardMatch(text, pattern) {
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
function matches(r, text) {
  if (r.re) return r.re.test(text);
  return r.caseSensitive ? wildcardMatch(text, r.pattern) : wildcardMatch(text.toUpperCase(), r.pattern.toUpperCase());
}
function included(rules, path, name, kind, top) {
  for (let i = rules.rules.length - 1; i >= 0; i--) {
    const r = rules.rules[i];
    if (r.target !== "a" && r.target !== kind) continue;
    if (r.type === "N" && !top) continue;
    if (matches(r, r.type === "p" ? path : name)) return r.include;
  }
  return true;
}
async function countCovered(fs, root, rules, sep = "/") {
  const started = Date.now();
  const approximate = [...rules.approximate];
  let files = 0;
  let bytes2 = 0;
  const queue = [{ abs: root, rel: "" }];
  const sizes = [];
  let nestedIgnore = false;
  while (queue.length) {
    const { abs, rel } = queue.pop();
    let entries;
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
              if (rules.largerThan !== null && st.size > rules.largerThan || rules.smallerThan !== null && st.size < rules.smallerThan) return;
              files++;
            }
            bytes2 += st.size;
          },
          () => void 0
        )
      );
      if (sizes.length >= 256) await Promise.all(sizes.splice(0));
    }
  }
  await Promise.all(sizes);
  if (nestedIgnore) approximate.push(".megaignore files inside sub-folders (only the vault's own is read)");
  return { files, bytes: bytes2, approximate, ms: Date.now() - started };
}

// src/core/settings.ts
var SETTINGS_VERSION = 3;
var DEFAULT_EXCLUDES = [".git/**", "node_modules/**"].join("\n");
function defaultSettings(vaultName) {
  const name = vaultName.replace(/[\u0000-\u001f"\\/]/g, "").trim() || "Obsidian";
  return {
    settingsVersion: SETTINGS_VERSION,
    remoteFolder: `/${name}`,
    excludePatterns: DEFAULT_EXCLUDES,
    includePatterns: "",
    syncConfigFolder: true,
    showStatusBar: true,
    showRibbon: true,
    logAutoscroll: true,
    logFilter: "all"
  };
}
var DEFAULT_DEVICE = { clientPath: "", startServerOnLoad: false, idlePollSeconds: 30, logWrap: true };
var LEGACY_CREDENTIAL_KEYS = ["email", "password", "secondFactorCode", "session", "settingsPassword", "secretsEncrypted", "secretsBlob"];
var str = (v, d) => typeof v === "string" ? v : d;
var bool = (v, d) => typeof v === "boolean" ? v : d;
function withoutCredentials(o) {
  const rest = {};
  let removed = false;
  for (const k of Object.keys(o)) {
    if (LEGACY_CREDENTIAL_KEYS.includes(k)) removed = true;
    else rest[k] = o[k];
  }
  return { rest, removed };
}
function migrate(raw, vaultName) {
  const d = defaultSettings(vaultName);
  const whole = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  const { rest: src, removed } = withoutCredentials(whole);
  const notes = [];
  if (removed) notes.push("Removed the sign-in data version 2 stored in data.json (3.x never uses it; MEGAcmd keeps its own session).");
  if (typeof src.settingsVersion === "number" && src.settingsVersion >= SETTINGS_VERSION) {
    const filter = src.logFilter;
    const settings2 = {
      settingsVersion: SETTINGS_VERSION,
      remoteFolder: str(src.remoteFolder, d.remoteFolder),
      excludePatterns: str(src.excludePatterns, d.excludePatterns),
      includePatterns: str(src.includePatterns, d.includePatterns),
      syncConfigFolder: bool(src.syncConfigFolder, d.syncConfigFolder),
      showStatusBar: bool(src.showStatusBar, d.showStatusBar),
      showRibbon: bool(src.showRibbon, d.showRibbon),
      logAutoscroll: bool(src.logAutoscroll, d.logAutoscroll),
      logFilter: filter === "plugin" || filter === "megacmd" || filter === "sync" ? filter : "all"
    };
    return { data: { ...settings2 }, settings: settings2, migrated: false, credentialsRemoved: removed, dropped: null, notes };
  }
  const isLegacy = Object.keys(whole).length > 0;
  const settings = { ...d };
  if (isLegacy) {
    const base = str(src.baseFolder, "").trim().replace(/^\/+|\/+$/g, "");
    const sub = str(src.remoteSubFolder, "").trim().replace(/^\/+|\/+$/g, "");
    if (base) {
      settings.remoteFolder = "/" + [base, sub].filter(Boolean).join("/");
      notes.push(`MEGA folder ${settings.remoteFolder}, from 2.x's base folder "${base}"${sub ? ` and sub-folder "${sub}"` : ""}.`);
    }
    if (typeof src.excludePatterns === "string") settings.excludePatterns = src.excludePatterns;
    if (typeof src.includePatterns === "string") settings.includePatterns = src.includePatterns;
    if (typeof src.syncVaultConfig === "boolean") settings.syncConfigFolder = src.syncVaultConfig;
    if (typeof src.showStatusBar === "boolean") settings.showStatusBar = src.showStatusBar;
    if (typeof src.showRibbon === "boolean") settings.showRibbon = src.showRibbon;
    notes.push("Carried over from 2.x: the exclude and include patterns, syncing the configuration folder, the status bar and ribbon switches.");
    for (const k of ["ignorePathsRegex", "onlyAllowPathsRegex"]) {
      if (typeof src[k] === "string" && src[k].trim()) notes.push(`Not carried over: ${k} (JavaScript regular expressions have no exact MEGA equivalent); add MEGA rules to .megaignore by hand if needed.`);
    }
  }
  return { data: { ...settings }, settings, migrated: isLegacy, credentialsRemoved: removed, dropped: isLegacy ? src : null, notes };
}
function readDevice(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const poll = typeof r.idlePollSeconds === "number" && Number.isFinite(r.idlePollSeconds) ? Math.min(600, Math.max(10, Math.round(r.idlePollSeconds))) : DEFAULT_DEVICE.idlePollSeconds;
  return { clientPath: str(r.clientPath, ""), startServerOnLoad: bool(r.startServerOnLoad, false), idlePollSeconds: poll, logWrap: bool(r.logWrap, true) };
}

// src/node.ts
function loadNode() {
  try {
    const cp = require("child_process");
    const fs = require("fs");
    const os = require("os");
    const proc = require("process");
    const path = require("path");
    return { cp, fsp: fs.promises, wfs: fs.promises, afs: fs.promises, path, os, env: proc.env };
  } catch {
    return null;
  }
}

// src/ui/modals.ts
var import_obsidian = require("obsidian");
var Confirm = class extends import_obsidian.Modal {
  constructor(app, heading, body, yes, risky, resolve) {
    super(app);
    this.done = false;
    this.heading = heading;
    this.body = body;
    this.yes = yes;
    this.risky = risky;
    this.resolve = resolve;
  }
  onOpen() {
    this.titleEl.setText(this.heading);
    this.modalEl.addClass("mega-route-modal");
    this.body(this.contentEl);
    new import_obsidian.Setting(this.contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(false))).addButton((b) => {
      b.setButtonText(this.yes).onClick(() => this.finish(true));
      if (this.risky) b.setWarning();
      else b.setCta();
    });
  }
  finish(ok) {
    if (this.done) return;
    this.done = true;
    this.resolve(ok);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
    if (!this.done) {
      this.done = true;
      this.resolve(false);
    }
  }
};
function confirm(app, heading, body, yes, risky = false) {
  return new Promise((resolve) => new Confirm(app, heading, body, yes, risky, resolve).open());
}
function confirmCreate(app, plan) {
  return new Promise((resolve) => {
    let answered = false;
    const m = new class extends import_obsidian.Modal {
      onOpen() {
        this.titleEl.setText(plan.ok ? "Create the sync?" : "The sync cannot be created yet");
        this.modalEl.addClass("mega-route-modal");
        const c = this.contentEl;
        const table = c.createEl("table", { cls: "mega-route-plan" });
        const row = (k, v) => {
          const tr = table.createEl("tr");
          tr.createEl("th", { text: k });
          tr.createEl("td", { text: v });
        };
        row("This vault", plan.local);
        row("MEGA folder", plan.remote);
        row("Kind", "Two-way: additions, changes and deletions on either side are made on the other.");
        if (plan.remoteExists) row("In the MEGA folder", plan.remoteCount ? `${plan.remoteCount} item${plan.remoteCount === 1 ? "" : "s"} at the top${plan.remoteItems.length ? `: ${plan.remoteItems.slice(0, 12).join(", ")}${plan.remoteCount > 12 ? ", \u2026" : ""}` : ""}` : "nothing (empty)");
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
            text: "Deleted files are not lost at once: MEGA keeps those deleted in the vault in its Rubbish Bin (SyncDebris), and those deleted on MEGA in a hidden debris folder at the vault's top."
          });
          const d = c.createEl("details");
          d.createEl("summary", { text: "The .megaignore file that will be written first" });
          d.createEl("pre", { cls: "mega-route-pre", text: plan.ignoreText });
        }
        const s = new import_obsidian.Setting(c);
        s.addButton((b) => b.setButtonText("Cancel").onClick(() => this.answer("cancel")));
        const missing = plan.blockers.some((x) => x.includes("does not exist on MEGA"));
        if (missing && plan.blockers.length === 1) {
          s.addButton((b) => b.setButtonText(`Create ${plan.remote} on MEGA`).onClick(() => this.answer("mkdir")));
        }
        if (plan.ok) s.addButton((b) => b.setButtonText("Create the sync").setCta().onClick(() => this.answer("create")));
      }
      answer(a) {
        if (answered) return;
        answered = true;
        resolve(a);
        this.close();
      }
      onClose() {
        this.contentEl.empty();
        if (!answered) {
          answered = true;
          resolve("cancel");
        }
      }
    }(app);
    m.open();
  });
}

// src/ui/settingsTab.ts
var import_obsidian3 = require("obsidian");

// src/ui/logPane.ts
var import_obsidian2 = require("obsidian");
var MAX_DOM_LINES = 2e3;
var LogPane = class {
  constructor(host) {
    this.unsubscribe = null;
    this.stopTail = null;
    this.host = host;
  }
  shows(l) {
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
  mount(parent) {
    const wrap = parent.createDiv({ cls: "mega-route-logpane" });
    const bar = wrap.createDiv({ cls: "mega-route-logbar" });
    const select = bar.createEl("select", { cls: "dropdown" });
    const options = [
      ["all", "Everything"],
      ["plugin", "MEGA-Route only"],
      ["megacmd", "MEGAcmd only"],
      ["sync", "Syncs and transfers"]
    ];
    for (const [value, label] of options) select.createEl("option", { value, text: label });
    select.value = this.host.settings.logFilter;
    select.setAttr("aria-label", "Lines to show");
    select.addEventListener("change", async () => {
      this.host.settings.logFilter = select.value;
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
    (0, import_obsidian2.setIcon)(copy, "copy");
    copy.addEventListener("click", async () => {
      const text = this.host.log.all().filter((l) => this.shows(l)).map((l) => formatLine(l)).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        new import_obsidian2.Notice("MEGA-Route: log copied. Check it for addresses and paths before sharing it.");
      } catch (e) {
        new import_obsidian2.Notice(`MEGA-Route: could not copy the log (${e instanceof Error ? e.message : String(e)}).`);
      }
    });
    const clear = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Clear the pane (the files are not changed)" } });
    (0, import_obsidian2.setIcon)(clear, "eraser");
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
  applyWrap() {
    const c = wrapClasses(this.host.getWrap());
    this.box.removeClass(c.remove);
    this.box.addClass(c.add);
  }
  renderAll() {
    this.box.empty();
    const lines = this.host.log.all().filter((l) => this.shows(l));
    for (const l of lines.slice(-MAX_DOM_LINES)) this.lineEl(l);
    if (!lines.length) this.box.createDiv({ cls: "mega-route-logempty", text: "No log lines yet." });
    this.scrollToEnd(true);
  }
  lineEl(l) {
    const div = this.box.createDiv({ cls: `mega-route-logline is-${l.source} is-${l.level}`, text: formatLine(l) });
    div.dataset.t = String(l.t);
  }
  append(added) {
    const shown = added.filter((l) => this.shows(l));
    if (!shown.length) return;
    const empty = this.box.querySelector(".mega-route-logempty");
    if (empty) empty.remove();
    for (const l of shown) this.lineEl(l);
    while (this.box.childElementCount > MAX_DOM_LINES) this.box.firstElementChild?.remove();
    this.scrollToEnd();
  }
  scrollToEnd(force = false) {
    if (force || this.host.settings.logAutoscroll) this.box.scrollTop = this.box.scrollHeight;
  }
  unmount() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopTail?.();
    this.stopTail = null;
  }
};

// src/ui/settingsTab.ts
var LINKS = {
  install: "https://mega.io/cmd",
  guide: "https://github.com/meganz/MEGAcmd/blob/master/UserGuide.md",
  megaignore: "https://help.mega.io/installs-apps/desktop/megaignore",
  docs: "https://github.com/Gameboard-dev/mega-route#readme"
};
function link(el, text, href) {
  el.createEl("a", { text, href, attr: { target: "_blank", rel: "noopener" } });
}
function greyOut(set, tip) {
  if (!tip) return;
  set.controlEl.querySelectorAll("button, input, select, textarea").forEach((el) => el.disabled = true);
  set.settingEl.addClass("mega-route-disabled");
  set.settingEl.setAttr("aria-label", tip);
  set.descEl.createDiv({ cls: "mega-route-problem", text: tip });
}
var MobileSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
  }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl("p", {
      text: "MEGA-Route works only in Obsidian's desktop app: it runs MEGA's command-line tool MEGAcmd, which phones and tablets cannot run. Sync this vault on a phone with MEGA's own mobile app instead."
    });
  }
};
var MegaRouteSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.pane = null;
    this.statusBox = null;
    this.syncBox = null;
    this.off = null;
    this.updateSignIn = () => void 0;
    this.plugin = plugin;
  }
  display() {
    const c = this.containerEl;
    this.hide();
    c.empty();
    c.addClass("mega-route-settings");
    c.removeClass("mega-route-contents-layout");
    const p = this.plugin;
    const nav = c.createEl("nav", { cls: "mega-route-contents" });
    const intro = c.createEl("p", { cls: "setting-item-description" });
    intro.appendText("MEGA-Route keeps this vault in a two-way sync with a folder on MEGA. The sync itself is run by MEGA's command-line tool MEGAcmd, a separate program you install; this plugin sets it up and shows how it is doing. ");
    link(intro, "Documentation", LINKS.docs);
    intro.appendText(".");
    new import_obsidian3.Setting(c).setName("MEGAcmd").setHeading();
    this.statusBox = c.createDiv({ cls: "mega-route-statusbox" });
    this.renderStatus();
    this.buildSignIn(c);
    new import_obsidian3.Setting(c).setName("MEGAcmd's folder (this device)").setDesc(`Where MEGAcmd is installed: its folder, or its client program. Leave empty for the usual place (${p.sys ? p.sys.os === "windows" ? "%LOCALAPPDATA%\\MEGAcmd" : p.sys.os === "macos" ? "/Applications/MEGAcmd.app" : "/usr/bin" : "per system"}). Kept on this device only, never in the vault.`).addText(
      (t) => t.setPlaceholder("default").setValue(p.device.clientPath).onChange((v) => {
        p.device.clientPath = v.trim();
        p.saveDevice();
      })
    ).addButton(
      (b) => b.setButtonText("Check").onClick(async () => {
        await p.setupController();
        await p.refresh(true);
        new import_obsidian3.Notice(p.state.client.found ? `MEGA-Route: MEGAcmd found at ${p.state.client.path}.` : `MEGA-Route: ${p.state.client.reason ?? "MEGAcmd not found."}`, 8e3);
        this.display();
      })
    );
    new import_obsidian3.Setting(c).setName("Start MEGAcmd with Obsidian (this device)").setDesc("When Obsidian starts, start MEGAcmd's server if it is not running, which resumes the syncs it has. Off: MEGAcmd runs only when you start it (here, from the menu, or yourself).").addToggle(
      (t) => t.setValue(p.device.startServerOnLoad).onChange((v) => {
        p.device.startServerOnLoad = v;
        p.saveDevice();
      })
    );
    new import_obsidian3.Setting(c).setName("Status checks while idle (this device)").setDesc("Seconds between checks while the sync is idle and Obsidian has the focus (10 to 600). While the sync works: every 5 s. While Obsidian is in the background and the sync is idle: none.").addText(
      (t) => t.setValue(String(p.device.idlePollSeconds)).onChange((v) => {
        const n = Number(v);
        if (Number.isFinite(n)) {
          p.device.idlePollSeconds = Math.min(600, Math.max(10, Math.round(n)));
          p.saveDevice();
        }
      })
    );
    new import_obsidian3.Setting(c).setName("The sync").setHeading();
    const remote = new import_obsidian3.Setting(c).setName("MEGA folder").setDesc("The folder on MEGA that this vault syncs with, from the top of your Cloud Drive, such as /RAG. Used when the sync is created; changing it later does not move an existing sync.").addText(
      (t) => t.setValue(p.settings.remoteFolder).onChange(async (v) => {
        p.settings.remoteFolder = v.trim();
        await p.saveSettings();
        const ok = checkRemoteFolder(p.settings.remoteFolder);
        remote.descEl.toggleClass("mod-warning", !ok.ok);
        remoteProblem.setText(ok.ok ? "" : ok.reason);
      })
    );
    const remoteProblem = remote.descEl.createDiv({ cls: "mega-route-problem" });
    const rc = checkRemoteFolder(p.settings.remoteFolder);
    if (!rc.ok) remoteProblem.setText(rc.reason);
    this.syncBox = c.createDiv({ cls: "mega-route-syncbox" });
    this.renderSync();
    new import_obsidian3.Setting(c).setName("Exclusions").setHeading();
    const ex = c.createEl("p", { cls: "setting-item-description" });
    ex.appendText("Written as MEGA's own rules into the file .megaignore at the top of the vault, inside a block marked MEGA-Route; the rest of that file is left as it is. Both MEGAcmd and the MEGA desktop app read it. ");
    link(ex, "MEGA's rules", LINKS.megaignore);
    ex.appendText(". Patterns: relative to the vault's top; * for any characters within one name, ** across folders, ? for one character, folder/** for a folder and everything in it.");
    const preview = c.createEl("pre", { cls: "mega-route-pre" });
    const problems = c.createDiv({ cls: "mega-route-problem" });
    const help = c.createDiv({
      cls: "setting-item-description mega-route-help",
      text: "A pattern with * or ? becomes a MEGA rule of the form -pr:\u2026 (a regular expression over the whole path), so that * stays within one name as you wrote it."
    });
    const showPreview = () => {
      try {
        const b = buildBlock(p.ignoreOptions());
        preview.setText(b.rules.join("\n"));
        problems.setText(b.problems.map((x) => `Not written: "${x.pattern}" ${x.reason}.`).join("\n"));
        help.toggleClass("mega-route-hidden", !b.rules.some((r) => /^[-+][a-z]*r:/.test(r)));
      } catch (e) {
        problems.setText(e instanceof Error ? e.message : String(e));
      }
    };
    new import_obsidian3.Setting(c).setName("Leave out").setDesc("One pattern per line, e.g. .git/** or LaTeX/compiled/*.log.").addTextArea((t) => {
      t.inputEl.rows = 6;
      t.setValue(p.settings.excludePatterns).onChange(async (v) => {
        p.settings.excludePatterns = v;
        await p.saveSettings();
        showPreview();
        p.exclusionsChanged();
      });
    });
    new import_obsidian3.Setting(c).setName("Sync even so").setDesc("Patterns of paths to sync even when a rule above, or in the rest of .megaignore, leaves them out.").addTextArea((t) => {
      t.inputEl.rows = 3;
      t.setValue(p.settings.includePatterns).onChange(async (v) => {
        p.settings.includePatterns = v;
        await p.saveSettings();
        showPreview();
        p.exclusionsChanged();
      });
    });
    new import_obsidian3.Setting(c).setName("Sync Obsidian's settings folder").setDesc(`Sync ${this.app.vault.configDir} (settings, plugins, themes) with the vault. MEGA's default rules leave out every name starting with a dot; this brings the folder back. The window layout (workspace files) and this plugin's own folder are always left out.`).addToggle(
      (t) => t.setValue(p.settings.syncConfigFolder).onChange(async (v) => {
        p.settings.syncConfigFolder = v;
        await p.saveSettings();
        showPreview();
        p.exclusionsChanged();
      })
    );
    new import_obsidian3.Setting(c).setName("MEGA-Route's block in .megaignore").setDesc("The rules below are written when the sync is created, and again whenever these settings change while it exists. The last rule that matches a path decides, so the fixed rules at the end always apply.").addButton(
      (b) => b.setButtonText("Write to .megaignore now").onClick(async () => {
        if (!p.controller) return;
        try {
          const r = await p.controller.writeIgnore(p.ignoreOptions());
          new import_obsidian3.Notice(r.written ? "MEGA-Route: .megaignore updated." : "MEGA-Route: .megaignore was already up to date.");
        } catch (e) {
          new import_obsidian3.Notice(`MEGA-Route: could not write .megaignore: ${e instanceof Error ? e.message : String(e)}`, 1e4);
        }
      })
    );
    c.appendChild(preview);
    c.appendChild(problems);
    c.appendChild(help);
    showPreview();
    new import_obsidian3.Setting(c).setName("Status bar and ribbon").setHeading();
    new import_obsidian3.Setting(c).setName("Show in the status bar").addToggle(
      (t) => t.setValue(p.settings.showStatusBar).onChange(async (v) => {
        p.settings.showStatusBar = v;
        await p.saveSettings();
        p.applyVisibility();
      })
    );
    new import_obsidian3.Setting(c).setName("Show the ribbon icon").addToggle(
      (t) => t.setValue(p.settings.showRibbon).onChange(async (v) => {
        p.settings.showRibbon = v;
        await p.saveSettings();
        p.applyVisibility();
      })
    );
    new import_obsidian3.Setting(c).setName("Logs").setHeading();
    c.createEl("p", {
      cls: "setting-item-description",
      text: "MEGA-Route's own log, and MEGAcmd's server log as it grows, while this tab is open. MEGAcmd's log level is MEGAcmd's own setting (its log command); the pane shows whatever MEGAcmd writes."
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
      }
    });
    this.pane.mount(c);
    this.contents(c, nav);
    this.off = p.onStateChange(() => {
      this.renderStatus();
      this.renderSync();
      this.updateSignIn();
    });
    void (async () => {
      if (!p.state.client.found) await p.setupController();
      await p.refresh(true);
    })();
  }
  renderStatus() {
    const box = this.statusBox;
    if (!box) return;
    const p = this.plugin;
    const s = p.state;
    box.empty();
    const row = (name, value, level, fill) => {
      const set = new import_obsidian3.Setting(box).setName(name);
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
        el.appendText(" \xB7 ");
        link(el, "User guide", LINKS.guide);
      }
    );
    const ctl = controls(s);
    const server = row(
      "Server",
      !s.client.found ? "MEGAcmd is not installed" : s.server === "running" ? "Running" : s.server === "stopped" ? "Not running: no sync runs" : "Unknown",
      !s.client.found ? "off" : s.server === "running" ? "ok" : s.server === "stopped" ? "off" : "attention"
    );
    if (s.server === "running") server.addButton((b) => b.setButtonText("Stop\u2026").onClick(() => void p.stopServer()));
    else server.addButton((b) => b.setButtonText("Start MEGAcmd").setCta().onClick(() => void p.startServer()));
    greyOut(server, ctl.start.enabled || s.server === "running" ? null : ctl.start.tip);
    row(
      "Account",
      !s.client.found || s.server !== "running" ? "Unknown until MEGAcmd runs" : s.account.signedIn ? `Signed in${s.account.masked ? ` as ${s.account.masked}` : ""}` : s.account.signedIn === false ? "Not signed in: sign in below" : "Unknown",
      s.account.signedIn ? "ok" : s.account.signedIn === false ? "attention" : "off"
    );
    row(
      "MEGA desktop app",
      s.desktopApp === "running" ? "Running: make sure it does not sync or back up this vault's folder (or a folder containing it), see Troubleshooting" : s.desktopApp === "not-running" ? "Not running" : "Unknown",
      s.desktopApp === "running" ? "attention" : "off"
    );
    const shown = describe(s);
    const now = new import_obsidian3.Setting(box).setName("Now").setDesc(shown.long);
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
  buildSignIn(parent) {
    const p = this.plugin;
    const box = parent.createDiv({ cls: "mega-route-signin" });
    const opLine = box.createDiv({ cls: "mega-route-op", attr: { role: "status", "aria-live": "polite" } });
    const form = new import_obsidian3.Setting(box).setName("Sign in to MEGA").setDesc(
      "Your MEGA email and password are passed to MEGAcmd on this computer, which signs in and keeps its own session. The plugin does not store them or send them anywhere else."
    );
    const fields = form.controlEl.createDiv({ cls: "mega-route-signin-fields" });
    const email = fields.createEl("input", { type: "email", cls: "mega-route-input", attr: { placeholder: "Email", autocomplete: "off", spellcheck: "false", "aria-label": "MEGA email" } });
    const password = fields.createEl("input", { type: "password", cls: "mega-route-input", attr: { placeholder: "Password", autocomplete: "off", "aria-label": "MEGA password" } });
    const codeRow = new import_obsidian3.Setting(box).setName("One-time code (only if two-factor authentication is on)");
    const codeDesc = codeRow.descEl.createDiv({ text: "The six-digit code from your authenticator app. Leave it empty if your account has no two-factor authentication, or type it when MEGAcmd asks." });
    const code = codeRow.controlEl.createEl("input", {
      type: "text",
      cls: "mega-route-input mega-route-code",
      attr: { inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", pattern: "[0-9 ]*", placeholder: "Optional: 6 digits", spellcheck: "false", "aria-label": "One-time code" }
    });
    const cancel = codeRow.controlEl.createEl("button", { text: "Cancel", cls: "mega-route-hidden" });
    const button = codeRow.controlEl.createEl("button", { text: "Sign in", cls: "mod-cta" });
    const tip = box.createDiv({ cls: "mega-route-problem" });
    const outRow = new import_obsidian3.Setting(box).setName("Sign out of MEGA").setDesc("Pauses the sync, cancels transfers in progress, then signs MEGAcmd out, which also removes its sync of this vault. Your files stay as they are.");
    let outButton = null;
    outRow.addButton((b) => {
      outButton = b.buttonEl;
      b.setButtonText("Sign out\u2026").setWarning().onClick(() => void p.signOut());
    });
    let busy = false;
    let pending = null;
    const defaultDesc = codeDesc.getText();
    const answer = (v) => {
      const f = pending;
      pending = null;
      code.value = "";
      codeRow.settingEl.removeClass("mega-route-attention");
      codeDesc.setText(defaultDesc);
      cancel.addClass("mega-route-hidden");
      button.setText(busy ? "Signing in\u2026" : "Sign in");
      button.disabled = busy;
      f?.(v);
    };
    const go = async () => {
      if (busy || button.disabled) return;
      busy = true;
      const e = email.value;
      const pw = password.value;
      const early = code.value;
      password.value = "";
      code.value = "";
      button.disabled = true;
      button.setText("Signing in\u2026");
      try {
        await p.signIn(e, pw, {
          code: early.trim() ? early : void 0,
          askCode: (info) => new Promise((resolve) => {
            pending = resolve;
            codeDesc.setText(
              info.retry ? `That code was not accepted (wrong, or expired). Enter the next code from your authenticator app (try ${info.attempt} of ${info.of}); the password is not needed again.` : "Enter the code from your authenticator app: MEGAcmd is waiting for it."
            );
            codeRow.settingEl.addClass("mega-route-attention");
            cancel.removeClass("mega-route-hidden");
            button.setText("Send code");
            button.disabled = false;
            code.disabled = false;
            code.focus();
          }),
          done: () => answer(null)
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
      opLine.toggleClass("mega-route-hidden", !op);
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
      code.disabled = off || busy && !pending;
      button.disabled = off || busy && !pending;
      tip.setText(off && ctl.tip ? ctl.tip : "");
      const out = controls(s).signOut;
      if (outButton) outButton.disabled = !out.enabled || busy;
      outRow.settingEl.toggleClass("mega-route-disabled", !out.enabled);
      if (!out.enabled && out.tip) outRow.settingEl.setAttr("aria-label", out.tip);
      else outRow.settingEl.removeAttribute("aria-label");
      for (const row of [form.settingEl, codeRow.settingEl]) {
        if (off && ctl.tip) row.setAttr("aria-label", ctl.tip);
        else row.removeAttribute("aria-label");
        row.toggleClass("mega-route-disabled", off);
      }
    };
    this.updateSignIn();
  }
  /**
   * The tab's contents: a link to every section heading, beside the sections and in view as they scroll where the
   * window is wide (styles.css), in a line above them where it is not. Filled after the sections are drawn, so every
   * heading is listed; clicking one scrolls to it. The same layout as the author's other plugins' settings tabs.
   */
  contents(el, nav) {
    if (!nav.isConnected) return;
    const heads = Array.from(el.querySelectorAll(".setting-item-heading"));
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
      if (i + 1 < heads.length) links.createSpan({ cls: "mega-route-contents-sep", text: " \xB7 " });
    });
    el.addClass("mega-route-contents-layout");
  }
  renderSync() {
    const box = this.syncBox;
    if (!box) return;
    const p = this.plugin;
    const s = p.state;
    box.empty();
    const m = s.mine;
    if (m) {
      const shown = describe(s);
      const set = new import_obsidian3.Setting(box).setName(`Sync ${m.id}`);
      set.descEl.createSpan({ cls: `mega-route-dot is-${shown.level}` });
      set.descEl.appendText(`${m.localPath} \u2194 ${m.remotePath}`);
      set.descEl.createDiv({ text: `State ${m.runState}, status ${m.status}${m.error && m.error !== "NO" ? `, ${m.error}` : ""}. On MEGA: ${m.files ?? "?"} files, ${m.dirs ?? "?"} folders, ${m.size}.` });
      const paused = m.runState === "Disabled" || m.runState === "Suspended";
      if (paused) set.addButton((b) => b.setButtonText("Resume").setCta().onClick(() => void p.change("resume")));
      else set.addButton((b) => b.setButtonText("Pause").onClick(() => void p.change("pause")));
      set.addButton((b) => b.setButtonText("Remove\u2026").setWarning().onClick(() => void p.change("remove")));
      const ctl = controls(s).change;
      greyOut(set, ctl.enabled ? null : ctl.tip);
    } else {
      const ctl = controls(s).create;
      const set = new import_obsidian3.Setting(box).setName("No sync of this vault yet").setDesc("Checks MEGAcmd, the MEGA folder and the MEGA desktop app, shows what will happen, and creates the sync only when you confirm.");
      set.addButton((b) => {
        b.setButtonText("Check and create\u2026").onClick(() => void p.createSync());
        if (ctl.enabled) b.setCta();
      });
      greyOut(set, ctl.enabled ? null : ctl.tip);
    }
    const others = s.syncs.filter((r) => r !== m);
    if (others.length) {
      box.createDiv({ cls: "setting-item-description", text: `MEGAcmd's other syncs on this computer: ${others.map((r) => `${r.localPath} \u2194 ${r.remotePath} (${r.runState}, ${r.status})`).join("; ")}.` });
    }
  }
  hide() {
    this.pane?.unmount();
    this.pane = null;
    this.off?.();
    this.off = null;
  }
};

// src/main.ts
var DEVICE_KEY = "mega-route-device";
var LEGACY_DEVICE_ID_KEY = "mega-sync-fork-device-id";
var BACKUP_FILE = "settings-2.x-backup.json";
var BUSY_POLL_MS = 5e3;
var FULL_REFRESH_MS = 5 * 6e4;
var COUNT_EVERY_MS = 6e4;
var OP_KEY = "mega-route-operation";
var MegaRoutePlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    /** data.json as saved: the settings, plus the 2.x sign-in data until the user deletes it. */
    this.data = {};
    this.device = { ...DEFAULT_DEVICE };
    this.log = new LogBuffer(2e3);
    this.controller = null;
    this.node = null;
    this.sys = null;
    this.paths = null;
    this.vaultPath = "";
    this.shown = describe(emptyState());
    this.statusEl = null;
    this.ribbonEl = null;
    this.lastRefresh = 0;
    this.lastFull = 0;
    this.refreshing = false;
    this.ignoreTimer = null;
    this.listeners = /* @__PURE__ */ new Set();
    /** Whether "signed out" was already said since MEGAcmd was last seen signed in (said once, never repeated). */
    this.signedOutSaid = false;
    this.tracker = new ProgressTracker();
    this.meter = new ActivityMeter();
    this.progress = null;
    this.activity = null;
    this.local = null;
    this.counting = false;
    this.countDirty = true;
    this.lastCount = 0;
    this.wasBusy = false;
    /**
     * The action running or last finished, shown in the settings' sign-in section: a step with a spinner while it runs,
     * then its result, which stays until the next action (a failure also stays in the status bar's tooltip).
     */
    this.opStatus = null;
  }
  async onload() {
    if (!import_obsidian4.Platform.isDesktopApp) {
      this.addSettingTab(new MobileSettingTab(this.app, this));
      return;
    }
    this.node = loadNode();
    await this.loadSettings();
    this.device = readDevice(this.app.loadLocalStorage(DEVICE_KEY));
    try {
      window.localStorage.removeItem(LEGACY_DEVICE_ID_KEY);
    } catch {
    }
    if (!this.node) {
      this.say("error", "Node's modules could not be loaded, so MEGAcmd cannot be run from this Obsidian.");
    }
    await this.setupController();
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mega-route-status", "mod-clickable");
    this.registerDomEvent(this.statusEl, "click", (e) => this.menu(e));
    this.ribbonEl = this.addRibbonIcon("cloud", "MEGA-Route", (e) => this.menu(e));
    this.ribbonEl.addClass("mega-route-ribbon");
    this.applyVisibility();
    this.render();
    this.addCommand({ id: "refresh-status", name: "Refresh the sync's status", callback: () => void this.refresh(true) });
    this.addCommand({ id: "pause-sync", name: "Pause the sync", callback: () => void this.change("pause") });
    this.addCommand({ id: "resume-sync", name: "Resume the sync", callback: () => void this.change("resume") });
    this.addCommand({ id: "open-settings", name: "Open settings and logs", callback: () => this.openSettings() });
    this.addSettingTab(new MegaRouteSettingTab(this.app, this));
    const dirty = () => {
      this.countDirty = true;
    };
    this.registerEvent(this.app.vault.on("create", dirty));
    this.registerEvent(this.app.vault.on("delete", dirty));
    this.registerEvent(this.app.vault.on("rename", dirty));
    this.registerInterval(window.setInterval(() => this.tick(), 1e3));
    this.registerDomEvent(window, "focus", () => {
      if (Date.now() - this.lastRefresh > 3e3) void this.refresh(false);
    });
    this.app.workspace.onLayoutReady(async () => {
      if (this.device.startServerOnLoad && this.controller) {
        this.say("info", "Starting MEGAcmd's server, as set for this device (Start MEGAcmd with Obsidian).");
        await this.controller.startServer();
        this.lastFull = Date.now();
        this.afterRefresh();
      } else {
        await this.refresh(true);
      }
    });
    if (this.node && this.vaultPath) {
      const file = new LogFile(this.node.afs, this.node.path.join(this.vaultPath, this.pluginDir(), "mega-route.log"));
      for (const l of this.log.all()) if (l.source === "plugin") file.add(formatLine(l, true));
      this.register(this.log.subscribe((added) => added.forEach((l) => l.source === "plugin" && file.add(formatLine(l, true)))));
      let failed = false;
      this.registerInterval(
        window.setInterval(() => {
          void file.flush().then((e) => {
            if (e && !failed) {
              failed = true;
              console.error(`MEGA-Route: could not write ${file.path}: ${e}`);
            }
          });
        }, 2e3)
      );
      this.register(() => void file.flush());
    }
    this.say("info", `MEGA-Route ${this.manifest.version} loaded. It starts no sync itself: MEGAcmd runs the syncs it has.`);
  }
  onunload() {
    if (this.ignoreTimer !== null) window.clearTimeout(this.ignoreTimer);
    this.listeners.clear();
  }
  /** Adds a line to the plugin's log. */
  say(level, text) {
    this.log.add("plugin", level, text);
  }
  // ---------------------------------------------------------------- settings
  async loadSettings() {
    const raw = await this.loadData();
    const m = migrate(raw, this.app.vault.getName());
    this.settings = m.settings;
    this.data = m.data;
    if (m.migrated) {
      if (m.dropped && Object.keys(m.dropped).length) {
        const path = `${this.pluginDir()}/${BACKUP_FILE}`;
        try {
          if (!await this.app.vault.adapter.exists(path)) {
            await this.app.vault.adapter.write(path, JSON.stringify(m.dropped, null, 1));
            this.say("info", `The 2.x settings and sync state that no longer apply were kept in ${path} (without any sign-in data).`);
          }
        } catch (e) {
          this.say("error", `Could not keep the 2.x settings in ${path}: ${e instanceof Error ? e.message : String(e)}. The settings were not changed.`);
          for (const n of m.notes) this.say("info", n);
          return;
        }
      }
      for (const n of m.notes) this.say("info", n);
      await this.saveData(this.data);
      this.say("info", `Settings moved to version ${SETTINGS_VERSION}.`);
    } else if (m.credentialsRemoved) {
      for (const n of m.notes) this.say("info", n);
      await this.saveData(this.data);
    }
    await this.cleanBackup();
  }
  /** Takes any 2.x sign-in data out of the 2.x settings backup (earlier 3.0.x never wrote it there; this makes sure). */
  async cleanBackup() {
    const path = `${this.pluginDir()}/${BACKUP_FILE}`;
    try {
      if (!await this.app.vault.adapter.exists(path)) return;
      const parsed = JSON.parse(await this.app.vault.adapter.read(path));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const { rest, removed } = withoutCredentials(parsed);
      if (!removed) return;
      await this.app.vault.adapter.write(path, JSON.stringify(rest, null, 1));
      this.say("info", `Removed sign-in data from ${path}.`);
    } catch (e) {
      this.say("warn", `Could not check ${path} for sign-in data: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async saveSettings() {
    this.data = { ...this.settings };
    await this.saveData(this.data);
  }
  saveDevice() {
    this.app.saveLocalStorage(DEVICE_KEY, this.device);
  }
  pluginDir() {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }
  ignoreOptions() {
    return {
      configDir: this.app.vault.configDir,
      pluginDir: this.pluginDir(),
      excludePatterns: this.settings.excludePatterns,
      includePatterns: this.settings.includePatterns,
      syncConfigFolder: this.settings.syncConfigFolder
    };
  }
  // ---------------------------------------------------------------- MEGAcmd
  /** Finds MEGAcmd and builds the controller (again after the client path setting changes). */
  async setupController() {
    const node = this.node;
    const adapter = this.app.vault.adapter;
    this.vaultPath = adapter instanceof import_obsidian4.FileSystemAdapter ? adapter.getBasePath() : "";
    if (!node) {
      this.controller = null;
      return;
    }
    const plat = node.os.platform();
    const sys = { os: plat === "win32" ? "windows" : plat === "darwin" ? "macos" : "linux", env: node.env, home: node.os.homedir() };
    this.sys = sys;
    const wanted = this.device.clientPath.trim() || defaultClient(sys) || "";
    const check = await checkClientPath(sys, wanted, this.vaultPath, (p) => node.fsp.stat(p));
    this.paths = check.ok ? pathsFor(sys, check.path) : wanted ? pathsFor(sys, wanted) : null;
    const lister = processLister(sys);
    const ignorePath = node.path.join(this.vaultPath, ".megaignore");
    const backupPath = node.path.join(this.vaultPath, this.pluginDir(), "megaignore-before-last-write.txt");
    const env = {
      windows: sys.os === "windows",
      vaultPath: this.vaultPath,
      client: check.ok ? new ProcessRunner(node.cp, check.path, [], node.env) : null,
      clientPath: check.ok ? check.path : wanted || null,
      clientProblem: check.ok ? void 0 : check.reason,
      processes: lister ? new ProcessRunner(node.cp, lister.program, lister.args) : null,
      serverNames: serverProcessNames(sys.os),
      desktopAppNames: desktopAppProcessNames(sys.os),
      // Through Node's fs, not Obsidian's adapter: MEGA marks .megaignore hidden, and the adapter's writeFile ("w")
      // cannot replace a hidden file on Windows (EPERM). See core/fsio.ts.
      readIgnore: async () => {
        try {
          return new TextDecoder("utf-8").decode(await node.wfs.readFile(ignorePath));
        } catch (e) {
          if (e.code === "ENOENT") return null;
          throw new Error(`Could not read ${ignorePath}: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      writeIgnore: async (text) => {
        let before = null;
        try {
          before = await node.wfs.readFile(ignorePath);
        } catch {
          before = null;
        }
        if (before) {
          try {
            await writeInPlace(node.wfs, backupPath, new TextDecoder("utf-8").decode(before));
          } catch (e) {
            throw new Error(`.megaignore was not changed, because its copy could not be kept first. ${writeFailure(backupPath, e)}`);
          }
        }
        try {
          await writeInPlace(node.wfs, ignorePath, text);
        } catch (e) {
          throw new Error(`${writeFailure(ignorePath, e)} Its previous content is in ${backupPath}.`);
        }
      },
      log: (level, text) => this.say(level, text)
    };
    this.controller = new Controller(env);
    if (check.ok) this.say("info", `MEGAcmd's client: ${check.path}`);
    else this.say("warn", `MEGAcmd not found: ${check.reason} Install MEGAcmd (Settings \u2192 MEGA-Route \u2192 MEGAcmd), or set the path of its client program for this device.`);
    if (!this.vaultPath) this.say("error", "The vault's folder on disk is unknown, so it cannot be synced.");
  }
  get state() {
    return this.controller?.state ?? emptyState();
  }
  /** Asks MEGAcmd for the current state (never while its server is stopped: that would start it). */
  async refresh(full) {
    if (!this.controller || this.refreshing) return;
    this.refreshing = true;
    try {
      const doFull = full || Date.now() - this.lastFull > FULL_REFRESH_MS;
      await this.controller.refresh(doFull);
      if (doFull) this.lastFull = Date.now();
    } catch (e) {
      this.say("error", `Checking the sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.refreshing = false;
      this.afterRefresh();
    }
  }
  afterRefresh() {
    this.lastRefresh = Date.now();
    const acc = this.state.account.signedIn;
    if (acc === true) this.signedOutSaid = false;
    else if (acc === false && this.state.server === "running" && !this.signedOutSaid && !this.state.operation) {
      this.signedOutSaid = true;
      new import_obsidian4.Notice("MEGA-Route is signed out of MEGA, so nothing syncs. Sign in again in its settings (Settings \u2192 MEGA-Route \u2192 Sign in to MEGA).", 15e3);
      this.say("warn", "MEGAcmd is not signed in to MEGA: no sync runs until you sign in again in the settings.");
    }
    this.reconcileOperation();
    const busy = isBusy(this.state);
    if (this.state.mine && busy && !this.counting && (this.local === null || this.countDirty && Date.now() - this.lastCount > COUNT_EVERY_MS || !this.wasBusy)) {
      void this.countLocal();
    }
    if (!busy) this.meter.reset();
    this.wasBusy = busy;
    this.progress = this.tracker.update(this.state.mine, this.state.transfers, this.local);
    this.activity = busy ? this.meter.observe(Date.now(), this.state.mine, this.local, this.state.current, this.state.transfers) : null;
    this.show();
  }
  /** Works out what to show from the state, logs a change of kind, and redraws. */
  show() {
    const before = this.shown;
    this.shown = describe(this.state, this.progress, this.activity);
    const op = this.opStatus;
    if (op?.running) {
      this.shown = { level: "busy", short: op.short ?? "working\u2026", long: op.text, progress: null };
    } else if (op && !op.ok && this.shown.level !== "error") {
      this.shown = { ...this.shown, long: `${this.shown.long} ${op.text}` };
    }
    const kind = (s) => `${s.level} ${s.short.replace(/[\d,.%]+/g, "#").replace(/ · .*$/, "")}`;
    if (kind(before) !== kind(this.shown)) this.say(this.shown.level === "error" ? "error" : "info", `Status: ${this.shown.short}. ${this.shown.long}`);
    this.render();
    for (const f of this.listeners) f();
  }
  setOp(running, text, ok, short) {
    this.opStatus = { running, text, ok, short };
    this.show();
  }
  /**
   * A sign-out leaves a note in this device's storage when it starts, and removes it when it has finished. If Obsidian
   * closed or reloaded half-way, the note is still there at the next start; MEGAcmd's real state (whoami, sync) then
   * says how far it got, and the settings say so plainly.
   */
  reconcileOperation() {
    if (this.state.operation) return;
    let note = null;
    try {
      note = this.app.loadLocalStorage(OP_KEY);
    } catch {
      note = null;
    }
    if (!note || note.op !== "sign-out") return;
    const r = interruptedSignOut(this.state);
    if (!r) return;
    this.app.saveLocalStorage(OP_KEY, null);
    this.say(r.finished ? "info" : "warn", r.text);
    this.setOp(false, r.text, r.finished);
  }
  /** Counts the vault's files that the sync covers, with the `.megaignore` rules as MEGA reads them. */
  async countLocal() {
    const node = this.node;
    if (!node || !this.vaultPath || this.counting) return;
    this.counting = true;
    try {
      let text = null;
      try {
        text = new TextDecoder("utf-8").decode(await node.wfs.readFile(node.path.join(this.vaultPath, ".megaignore")));
      } catch {
        text = null;
      }
      const c = await countCovered(node.fsp, this.vaultPath, parseRules(text), this.sys?.os === "windows" ? "\\" : "/");
      this.local = { files: c.files, bytes: c.bytes, approximate: c.approximate };
      this.countDirty = false;
      this.lastCount = Date.now();
      this.say("debug", `Counted ${c.files} files (${c.bytes} bytes) the sync covers, in ${c.ms} ms.`);
      for (const a of c.approximate) this.say("info", `The file count for the progress is approximate: ${a}.`);
      this.progress = this.tracker.update(this.state.mine, this.state.transfers, this.local);
      this.show();
    } catch (e) {
      this.say("warn", `Could not count the vault's files for the progress: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.counting = false;
    }
  }
  /** Signs MEGAcmd out, after a confirmation that says what happens; each step shows in the settings as it runs. */
  async signOut() {
    if (!this.controller) return;
    if (this.state.operation) {
      new import_obsidian4.Notice(`MEGA-Route: ${this.state.operation} is in progress: wait for it to finish.`);
      return;
    }
    const ok = await confirm(
      this.app,
      "Sign out of MEGA?",
      (el) => {
        el.createEl("p", { text: "MEGA-Route will, in this order, and stop at the first step that fails:" });
        const ol = el.createEl("ol");
        ol.createEl("li", { text: "pause the sync of this vault: its transfers stop, and an upload that has not finished is not created on MEGA;" });
        ol.createEl("li", { text: "stop any other transfer in progress (nothing in the vault changes);" });
        ol.createEl("li", { text: "sign MEGAcmd out: MEGA ends the session, and MEGAcmd deletes its saved session and its sync of this vault." });
        el.createEl("p", { text: "Your files stay as they are, in the vault and on MEGA. To sync again, sign in (your password, and the one-time code if two-factor authentication is on), then press Check and create\u2026 to set the sync up again." });
      },
      "Sign out",
      true
    );
    if (!ok) return;
    this.app.saveLocalStorage(OP_KEY, { op: "sign-out", at: Date.now() });
    this.setOp(true, "Signing out: starting\u2026", void 0, "signing out\u2026");
    const r = await this.controller.signOut((n, of, text) => this.setOp(true, `Signing out: step ${n} of ${of}, ${text}\u2026`, void 0, `signing out ${n}/${of}`));
    this.app.saveLocalStorage(OP_KEY, null);
    this.tracker.reset();
    this.meter.reset();
    this.local = null;
    new import_obsidian4.Notice(`MEGA-Route: ${r.message}`, r.ok ? 6e3 : 15e3);
    if (r.ok) this.signedOutSaid = true;
    this.setOp(false, r.ok ? "Signed out of MEGA." : r.message, r.ok);
    this.afterRefresh();
  }
  /** Every second: decides whether a status check is due. While the sync works: every 5 s. While idle: only when
   *  Obsidian has the focus, every `idlePollSeconds`. Otherwise not at all. */
  tick() {
    if (!this.controller || this.refreshing) return;
    const busy = isBusy(this.state);
    const focused = document.hasFocus();
    const every = busy ? BUSY_POLL_MS : focused ? this.device.idlePollSeconds * 1e3 : 0;
    if (every && Date.now() - this.lastRefresh >= every) void this.refresh(false);
  }
  onStateChange(f) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  async change(action) {
    if (!this.controller) return;
    if (!this.state.mine) await this.refresh(false);
    if (!this.state.mine) {
      new import_obsidian4.Notice("MEGA-Route: MEGAcmd has no sync of this vault.");
      return;
    }
    if (action === "remove") {
      const mine = this.state.mine;
      const ok = await confirm(
        this.app,
        "Remove the sync?",
        (el) => {
          el.createEl("p", { text: `MEGAcmd stops syncing ${mine.localPath} with ${mine.remotePath} and forgets this sync.` });
          el.createEl("p", { text: "No file is deleted, in the vault or on MEGA. To sync again later, create the sync again (both sides are then compared afresh)." });
        },
        "Remove the sync",
        true
      );
      if (!ok) return;
    }
    const r = await this.controller.change(action);
    new import_obsidian4.Notice(`MEGA-Route: ${r.message}`, r.ok ? 4e3 : 1e4);
    if (!r.ok) this.say("error", r.message);
    this.afterRefresh();
  }
  /** The checks, the dialog, then the sync's creation. */
  async createSync() {
    if (!this.controller) return;
    for (; ; ) {
      const plan = await this.controller.planCreate(this.settings.remoteFolder, this.ignoreOptions());
      this.say("info", `Checks before creating the sync: ${plan.blockers.length} blocking, ${plan.warnings.length} to note.`);
      for (const b of plan.blockers) this.say("warn", `Blocking: ${b}`);
      for (const w of plan.warnings) this.say("info", `Note: ${w}`);
      this.afterRefresh();
      const answer = await confirmCreate(this.app, plan);
      if (answer === "cancel") return;
      if (answer === "mkdir") {
        const r2 = await this.controller.makeRemoteFolder(plan.remote);
        new import_obsidian4.Notice(`MEGA-Route: ${r2.message}`, r2.ok ? 4e3 : 1e4);
        if (!r2.ok) return;
        continue;
      }
      const r = await this.controller.create(plan, this.ignoreOptions());
      new import_obsidian4.Notice(`MEGA-Route: ${r.message}`, r.ok ? 6e3 : 12e3);
      if (!r.ok) this.say("error", r.message);
      this.afterRefresh();
      return;
    }
  }
  async startServer() {
    if (!this.controller) return;
    const r = await this.controller.startServer();
    this.lastFull = Date.now();
    new import_obsidian4.Notice(`MEGA-Route: ${r.message}`, r.ok ? 4e3 : 1e4);
    this.afterRefresh();
  }
  async stopServer() {
    if (!this.controller) return;
    const ok = await confirm(
      this.app,
      "Stop MEGAcmd?",
      (el) => el.createEl("p", { text: "MEGAcmd's server stops, and with it every sync it runs on this computer, until it is started again. Transfers in progress resume then." }),
      "Stop MEGAcmd",
      true
    );
    if (!ok) return;
    const r = await this.controller.stopServer();
    new import_obsidian4.Notice(`MEGA-Route: ${r.message}`, r.ok ? 4e3 : 1e4);
    this.afterRefresh();
  }
  /** Signs MEGAcmd in with what was typed in the settings. The values are passed on and dropped; the caller clears
   *  its fields. Messages never hold the password, the code or the full address. */
  async signIn(email, password, ui) {
    if (!this.controller) return { ok: false, kind: "not-found", message: "MEGAcmd was not found." };
    if (this.state.operation) {
      const message = `${this.state.operation} is in progress: wait for it to finish.`;
      new import_obsidian4.Notice(`MEGA-Route: ${message}`);
      return { ok: false, kind: "busy", message };
    }
    const started = Date.now();
    let waitingForCode = false;
    const say = () => {
      const s = Math.round((Date.now() - started) / 1e3);
      this.setOp(
        true,
        waitingForCode ? "Signing in: MEGAcmd is waiting for the one-time code." : `Signing in\u2026 ${s} s (MEGA is checking your password, then MEGAcmd loads your account's file list)`,
        void 0,
        waitingForCode ? "signing in: code?" : `signing in ${s} s`
      );
    };
    say();
    const timer = window.setInterval(say, 1e3);
    try {
      const r = await this.controller.signIn(email, password, {
        ...ui,
        askCode: (info) => {
          waitingForCode = true;
          say();
          return ui.askCode(info).finally(() => {
            waitingForCode = false;
          });
        }
      });
      this.lastFull = Date.now();
      this.say("info", `Sign-in took ${Date.now() - started} ms.`);
      new import_obsidian4.Notice(`MEGA-Route: ${r.message}`, r.ok ? 5e3 : 12e3);
      window.clearInterval(timer);
      this.setOp(false, r.message, r.ok);
      this.afterRefresh();
      return r;
    } finally {
      window.clearInterval(timer);
    }
  }
  /** Follows MEGAcmd's log file into the log, every second, until stopped (the settings tab's log pane). */
  followMegaCmdLog() {
    const node = this.node;
    const path = this.paths?.log;
    if (!node || !path) return { where: "unknown (MEGAcmd was not found)", stop: () => void 0 };
    const tail = new LogTail(node.fsp, path);
    let missingSaid = false;
    let running = false;
    const id = window.setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const r = await tail.poll();
        if (r.missing && !missingSaid) {
          missingSaid = true;
          this.say("info", `MEGAcmd's log file is not there yet (${path}); it appears once MEGAcmd's server has run.`);
        }
        if (r.restarted) this.log.add("megacmd", "info", "(the log file was started again: MEGAcmd rotated it)");
        if (r.skipped) this.log.add("megacmd", "info", `(${r.skipped} bytes skipped: the log grew faster than the pane reads it)`);
        for (const line of r.lines.map(redactMegaCmdLine)) this.log.add("megacmd", /\bERR\b|error/i.test(line) ? "error" : /\bWARN/i.test(line) ? "warn" : "info", line);
      } catch (e) {
        this.say("warn", `Could not read MEGAcmd's log (${path}): ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        running = false;
      }
    }, 1e3);
    return { where: path, stop: () => window.clearInterval(id) };
  }
  /** Writes the exclusions to .megaignore soon, when a sync of this vault exists (otherwise they are written when the
   *  sync is created). */
  exclusionsChanged() {
    this.countDirty = true;
    if (this.ignoreTimer !== null) window.clearTimeout(this.ignoreTimer);
    this.ignoreTimer = window.setTimeout(async () => {
      this.ignoreTimer = null;
      if (!this.controller || !this.state.mine) return;
      try {
        await this.controller.writeIgnore(this.ignoreOptions());
      } catch (e) {
        this.say("error", `Could not write .megaignore: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 1500);
  }
  // ---------------------------------------------------------------- status bar, ribbon, menu
  applyVisibility() {
    this.statusEl?.toggleClass("mega-route-hidden", !this.settings.showStatusBar);
    this.ribbonEl?.toggleClass("mega-route-hidden", !this.settings.showRibbon);
  }
  render() {
    const s = this.shown;
    const tip = `MEGA-Route: ${s.long}
Click for the menu`;
    if (this.statusEl) {
      this.statusEl.empty();
      this.statusEl.createSpan({ cls: `mega-route-dot is-${s.level}` });
      this.statusEl.createSpan({ text: `MEGA: ${s.short}` });
      this.statusEl.setAttr("aria-label", tip);
      this.statusEl.setAttr("data-tooltip-position", "top");
    }
    if (this.ribbonEl) {
      for (const l of ["ok", "busy", "paused", "attention", "error", "off"]) this.ribbonEl.removeClass(`is-${l}`);
      this.ribbonEl.addClass(`is-${s.level}`);
      this.ribbonEl.setAttr("aria-label", tip);
      this.ribbonEl.style.setProperty("--mega-route-progress", String(s.progress ?? 0));
      this.ribbonEl.toggleClass("has-progress", s.progress !== null);
    }
  }
  /** The menu of the ribbon icon and the status bar. */
  menu(e) {
    const m = new import_obsidian4.Menu();
    const st = this.state;
    m.addItem((i) => i.setTitle(`MEGA: ${this.shown.short}`).setIcon("cloud").setDisabled(true));
    m.addItem((i) => i.setTitle("Refresh status").setIcon("refresh-cw").onClick(() => void this.refresh(true)));
    m.addSeparator();
    if (st.mine) {
      const paused = st.mine.runState === "Disabled" || st.mine.runState === "Suspended";
      if (paused) m.addItem((i) => i.setTitle("Resume the sync").setIcon("play").onClick(() => void this.change("resume")));
      else m.addItem((i) => i.setTitle("Pause the sync").setIcon("pause").onClick(() => void this.change("pause")));
    } else if (st.server === "running" && st.account.signedIn) {
      m.addItem((i) => i.setTitle("Create the sync\u2026").setIcon("plus").onClick(() => void this.createSync()));
    }
    if (st.client.found) {
      if (st.server === "stopped") m.addItem((i) => i.setTitle("Start MEGAcmd").setIcon("play").onClick(() => void this.startServer()));
      else if (st.server === "running") m.addItem((i) => i.setTitle("Stop MEGAcmd\u2026").setIcon("square").onClick(() => void this.stopServer()));
      if (st.server === "running" && st.account.signedIn === false) m.addItem((i) => i.setTitle("Sign in to MEGA\u2026").setIcon("log-in").onClick(() => this.openSettings()));
    }
    m.addSeparator();
    m.addItem((i) => i.setTitle("Settings and logs").setIcon("settings").onClick(() => this.openSettings()));
    m.showAtMouseEvent(e);
  }
  openSettings() {
    const setting = this.app.setting;
    if (!setting) return;
    setting.open();
    setting.openTabById(this.manifest.id);
  }
};
