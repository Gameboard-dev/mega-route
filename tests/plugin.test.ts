// The built main.js loaded with a stand-in for Obsidian's API: it loads, moves 2.x settings (keeping a backup and the
// sign-in data), starts no sync and runs nothing when MEGAcmd is missing, and the status bar says so.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A minimal element: records classes, text, attributes and children. */
class El {
  cls = new Set<string>();
  text = "";
  attrs: Record<string, string> = {};
  children: El[] = [];
  style = { setProperty: () => undefined };
  addClass(...c: string[]) {
    c.forEach((x) => this.cls.add(x));
  }
  removeClass(c: string) {
    this.cls.delete(c);
  }
  toggleClass(c: string, on: boolean) {
    if (on) this.cls.add(c);
    else this.cls.delete(c);
  }
  empty() {
    this.children = [];
    this.text = "";
  }
  createSpan(o: { cls?: string; text?: string } = {}) {
    const e = new El();
    if (o.cls) o.cls.split(" ").forEach((c) => e.cls.add(c));
    e.text = o.text ?? "";
    this.children.push(e);
    return e;
  }
  setAttr(k: string, v: string) {
    this.attrs[k] = v;
  }
  allText(): string {
    return [this.text, ...this.children.map((c) => c.allText())].join(" ").trim();
  }
}

function loadPlugin(vault: string, data: unknown) {
  const files = new Map<string, string>();
  class FileSystemAdapter {
    getBasePath() {
      return vault;
    }
    async exists(p: string) {
      return files.has(p);
    }
    async read(p: string) {
      return files.get(p) ?? "";
    }
    async write(p: string, t: string) {
      files.set(p, t);
    }
  }
  const saved: unknown[] = [];
  const statusBar: El[] = [];
  const intervals: unknown[] = [];
  let layoutReady: (() => unknown) | null = null;
  class Plugin {
    app: unknown;
    manifest: unknown;
    constructor(app: unknown, manifest: unknown) {
      this.app = app;
      this.manifest = manifest;
    }
    async loadData() {
      return data;
    }
    async saveData(d: unknown) {
      saved.push(JSON.parse(JSON.stringify(d)));
    }
    addStatusBarItem() {
      const e = new El();
      statusBar.push(e);
      return e;
    }
    addRibbonIcon() {
      return new El();
    }
    addCommand() {}
    addSettingTab() {}
    registerInterval(i: unknown) {
      intervals.push(i);
    }
    registerDomEvent() {}
    registerEvent() {}
    register() {}
  }
  const obsidian = {
    Plugin,
    FileSystemAdapter,
    PluginSettingTab: class {},
    Setting: class {},
    Modal: class {},
    Menu: class {},
    Notice: class {},
    Platform: { isDesktopApp: true },
    setIcon: () => undefined,
  };
  const g = globalThis as Record<string, unknown>;
  g.window = { setInterval: () => 1, clearInterval: () => undefined, setTimeout: () => 1, clearTimeout: () => undefined };
  g.document = { hasFocus: () => true };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mega-route-plugin-"));
  const copy = path.join(tmp, "main.cjs");
  fs.copyFileSync(path.join(root, "main.js"), copy);
  const req = createRequire(copy);
  const Module = req("module") as { _load: (r: string, ...a: unknown[]) => unknown };
  const orig = Module._load;
  Module._load = function (r: string, ...a: unknown[]) {
    return r === "obsidian" ? obsidian : orig.call(this, r, ...a);
  };
  try {
    const mod = req(copy) as { default: new (app: unknown, manifest: unknown) => Record<string, unknown> };
    const app = {
      vault: { adapter: new FileSystemAdapter(), configDir: ".obsidian", getName: () => "RAG", on: () => ({}) },
      workspace: { onLayoutReady: (f: () => unknown) => (layoutReady = f) },
      loadLocalStorage: () => ({ clientPath: path.join(tmp, "missing", "MegaClient.exe") }),
      saveLocalStorage: () => undefined,
    };
    const plugin = new mod.default(app, { id: "mega-route", version: "3.0.0", dir: ".obsidian/plugins/mega-route" });
    return { plugin, files, saved, statusBar, layoutReady: () => layoutReady, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  } finally {
    Module._load = orig;
  }
}

test("load with 2.x settings and no MEGAcmd: settings moved, backup kept, nothing run", async (t) => {
  if (!fs.existsSync(path.join(root, "main.js"))) return t.skip("main.js not built");
  const v2 = { email: "someone@example.com", password: "pw", session: { sid: "s" }, secretsEncrypted: false, baseFolder: "RAG", excludePatterns: ".trash/**", syncDirection: "upload-only", lastSnapshot: { v: 2, files: {} } };
  const h = loadPlugin(path.join(os.tmpdir(), "RAG"), v2);
  try {
    await (h.plugin.onload as () => Promise<void>).call(h.plugin);
    assert.equal(h.saved.length, 1, "data.json is saved once, by the migration");
    const data = h.saved[0] as Record<string, unknown>;
    assert.equal(data.remoteFolder, "/RAG");
    for (const k of ["email", "password", "session", "secretsEncrypted"]) assert.equal(k in data, false, `${k} removed from data.json`);
    assert.ok(!JSON.stringify(h.saved).includes("someone@example.com") && ![...h.files.values()].some((f) => f.includes("\"pw\"")), "the sign-in data is copied nowhere");
    assert.equal("lastSnapshot" in data, false);
    const backup = JSON.parse(h.files.get(".obsidian/plugins/mega-route/settings-2.x-backup.json")!);
    assert.deepEqual(backup.lastSnapshot, { v: 2, files: {} });
    assert.equal("password" in backup, false);
    assert.equal(h.files.has(".megaignore"), false, "nothing is written to .megaignore at load");
    await h.layoutReady()!();
    const bar = h.statusBar[0];
    assert.match(bar.allText(), /MEGA: MEGAcmd not found/);
    assert.ok(bar.children.some((c) => c.cls.has("is-off")));
  } finally {
    h.cleanup();
  }
});

test("a second load with version 3 settings saves nothing", async (t) => {
  if (!fs.existsSync(path.join(root, "main.js"))) return t.skip("main.js not built");
  const h = loadPlugin(path.join(os.tmpdir(), "RAG"), { settingsVersion: 3, remoteFolder: "/RAG", excludePatterns: "", includePatterns: "", syncConfigFolder: true, showStatusBar: true, showRibbon: true, logAutoscroll: true, logFilter: "all" });
  try {
    await (h.plugin.onload as () => Promise<void>).call(h.plugin);
    assert.equal(h.saved.length, 0);
    assert.equal(h.files.size, 0);
  } finally {
    h.cleanup();
  }
});
