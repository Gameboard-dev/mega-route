// The sync's progress: files in sync ÷ files covered, monotonic within a run; the .megaignore evaluation and the
// count of covered files.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProgressTracker, bytes, count, progressText, SMALL_RUN } from "../src/core/progress.ts";
import type { SyncRow, TransferSummary } from "../src/core/parse.ts";
import { countCovered, included, parseRules, wildcardMatch } from "../src/core/coverage.ts";
import type { WalkFs } from "../src/core/coverage.ts";
import { buildBlock, mergeIgnoreFile } from "../src/core/megaignore.ts";
import { describe as shown, emptyState } from "../src/core/status.ts";

const row = (files: number | null, status = "Syncing", size = "10.00 MB"): SyncRow => ({ id: "Ab12Cd34", localPath: "C:\\v", remotePath: "/RAG", runState: "Running", status, error: "NO", size, files, dirs: 1 });
const queue = (uploads: number, done: string, total: string): TransferSummary => ({ downloads: 0, downloaded: "0.00  B", downloadTotal: "0.00  B", downloadPercent: 0, uploads, uploaded: done, uploadTotal: total, uploadPercent: 0 });

test("a first upload: the queue grows and shrinks, the percentage only rises, 0% to 100%", () => {
  const t = new ProgressTracker();
  const local = { files: 6772, bytes: 1.1 * 1024 ** 3, approximate: [] };
  // MEGA's files rise as uploads complete; the queue's own numbers jump about (the reported 1% / 2% / 0%).
  const steps: [number, TransferSummary][] = [
    [0, queue(120, "0.00  B", "3.00 MB")],
    [10, queue(4706, "7.83 MB", "933.87 MB")],
    [150, queue(4782, "1.00 MB", "980.00 MB")],
    [140, queue(4600, "2.00 MB", "900.00 MB")], // MEGA's count read slightly lower once: held, not shown going back
    [3120, queue(3600, "400.00 MB", "520.00 MB")],
    [6700, queue(72, "5.00 MB", "6.00 MB")],
    [6772, queue(0, "0.00  B", "0.00  B")],
  ];
  let last = -1;
  for (const [files, q] of steps) {
    const p = t.update(row(files), q, local)!;
    assert.equal(p.kind, "percent");
    if (p.kind !== "percent") continue;
    assert.ok(p.percent >= last, `${p.percent} after ${last}`);
    assert.ok(p.percent <= 99, "100% waits for MEGAcmd to report the sync in sync");
    last = p.percent;
  }
  assert.equal(last, 99);
  const done = t.update(row(6772, "Synced"), queue(0, "0.00  B", "0.00  B"), local)!;
  assert.equal(done.kind, "synced");
  assert.equal(progressText(done).long, "In sync, 100%: 6,772 files, 10 MB on MEGA.");
  // A new run starts from 0 again.
  const again = t.update(row(6000), queue(700, "0.00  B", "70.00 MB"), local)!;
  assert.equal(again.kind, "percent");
});

test("the status bar and the tooltip agree, with readable counts and sizes", () => {
  const t = new ProgressTracker();
  const p = t.update(row(3120, "Syncing", "512.00 MB"), queue(3652, "1.00 MB", "613.00 MB"), { files: 6772, bytes: 1.1 * 1024 ** 3, approximate: [] })!;
  const text = progressText(p);
  assert.equal(text.short, "syncing 46%");
  assert.equal(text.long, "Syncing: 3,120 of 6,772 files (46%), 512 MB of 1.1 GB in sync; 3,652 files to upload, 612 MB left.");
  assert.equal(text.fraction, 0.46);
  const s = { ...emptyState(), client: { path: "x", found: true }, server: "running" as const, account: { signedIn: true }, mine: row(3120, "Syncing", "512.00 MB") };
  const d = shown(s, p);
  assert.equal(d.short, "syncing 46%");
  assert.ok(d.long.endsWith(text.long));
  assert.equal(count(1234567), "1,234,567");
  assert.equal(bytes(940 * 1024), "940 KB");
  assert.equal(bytes(1024), "1 KB");
});

test("a few edits: 'N files to upload', no 99.98% noise; downloads count the same way", () => {
  const t = new ProgressTracker();
  const p = t.update(row(6772), queue(1, "0.00  B", "12.00 KB"), { files: 6772, bytes: 1e9, approximate: [] })!;
  assert.equal(p.kind, "few");
  assert.equal(progressText(p).short, "syncing: 1 file to upload");
  // The remote side changed: files arrive in the vault (L rises towards R).
  const d = new ProgressTracker();
  const q = { ...queue(0, "0.00  B", "0.00  B"), downloads: 500, downloaded: "1.00 MB", downloadTotal: "50.00 MB" };
  const a = d.update(row(6772), q, { files: 6200, bytes: 1e9, approximate: [] })!;
  assert.equal(a.kind, "percent");
  const b = d.update(row(6772), q, { files: 6600, bytes: 1e9, approximate: [] })!;
  assert.ok(a.kind === "percent" && b.kind === "percent" && b.percent > a.percent);
  assert.ok(SMALL_RUN > 1);
});

test("no local count yet, or MEGAcmd still loading: counts only, no percentage", () => {
  const t = new ProgressTracker();
  const p = t.update(row(10), queue(4706, "7.83 MB", "933.87 MB"), null)!;
  assert.equal(p.kind, "few");
  assert.equal(progressText(p).short, "syncing: 4,706 files to upload");
  assert.equal(progressText(p).long, "Syncing: 4,706 files to upload, 926 MB left.");
  const s = t.update({ ...row(null), runState: "Loading", status: "NONE" }, null, null)!;
  assert.equal(s.kind, "scanning");
});

test(".megaignore evaluated as MEGA does: last rule wins, N only at the top, p paths, regex and glob", () => {
  assert.ok(wildcardMatch("A/B/C.LOG", "A/*.LOG"), "MEGA's glob * crosses /");
  assert.ok(!wildcardMatch("x.md", "*.txt"));
  const text = mergeIgnoreFile("-:Thumbs.db\n-:.*\n-p:*Private/Skills\n", buildBlock({ configDir: ".obsidian", pluginDir: ".obsidian/plugins/mega-route", excludePatterns: ".trash/**\nLaTeX/compiled/*.aux", includePatterns: "", syncConfigFolder: true }).rules);
  const r = parseRules(text);
  assert.deepEqual(r.approximate, []);
  assert.equal(included(r, ".obsidian", ".obsidian", "d", true), true, "+dN:.obsidian after -:.*");
  assert.equal(included(r, ".git", ".git", "d", true), false, "-:.* still applies to other dot names");
  assert.equal(included(r, ".obsidian/plugins/mega-route", "mega-route", "d", false), false);
  assert.equal(included(r, ".obsidian/workspace.json", "workspace.json", "f", false), false);
  assert.equal(included(r, "LaTeX/compiled/main.aux", "main.aux", "f", false), false);
  assert.equal(included(r, "LaTeX/compiled/sub/main.aux", "main.aux", "f", false), true, "the -pr: rule stays in its folder");
  assert.equal(included(r, "a/Private/Skills", "Skills", "d", false), false);
  assert.equal(included(r, "Notes/x.md", "x.md", "f", false), true);
  assert.ok(parseRules("exclude-larger:8M\n").approximate.length === 1);
  assert.match(parseRules("-x:bad\n").approximate[0], /would not accept/);
});

test("the covered files are counted with the exclusions applied (the vault's .megaignore itself not counted)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mega-route-count-"));
  const w = (p: string, s = "x") => {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), s);
  };
  try {
    w("Notes/a.md", "aaaa");
    w("Notes/b.md");
    w(".obsidian/app.json");
    w(".obsidian/workspace.json");
    w(".obsidian/plugins/mega-route/data.json");
    w(".trash/old.md");
    w("LaTeX/compiled/main.aux");
    w("LaTeX/compiled/main.pdf");
    w(".git/HEAD");
    w(".debris/x.md");
    w("Thumbs.db");
    const text = mergeIgnoreFile(null, buildBlock({ configDir: ".obsidian", pluginDir: ".obsidian/plugins/mega-route", excludePatterns: ".trash/**\nLaTeX/compiled/*.aux", includePatterns: "", syncConfigFolder: true }).rules);
    w(".megaignore", text);
    const c = await countCovered(fs.promises as unknown as WalkFs, dir, parseRules(text), path.sep);
    // Notes/a.md, Notes/b.md, .obsidian/app.json, LaTeX/compiled/main.pdf
    assert.equal(c.files, 4);
    assert.equal(c.bytes, 4 + 1 + 1 + 1);
    assert.deepEqual(c.approximate, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
