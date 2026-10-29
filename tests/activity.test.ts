// A run's activity (rate, the file being transferred, "no progress for N min"), the recovery after a sign-out cut
// short, and the plugin's log file.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ActivityMeter, ProgressTracker, STALL_MS, progressText, shortName } from "../src/core/progress.ts";
import type { SyncRow, TransferRow, TransferSummary } from "../src/core/parse.ts";
import { parseTransferList, COL_SEP } from "../src/core/parse.ts";
import { emptyState, interruptedSignOut } from "../src/core/status.ts";
import { LogFile } from "../src/core/logfile.ts";
import type { AppendFs } from "../src/core/logfile.ts";
import { adapterAppend } from "../src/core/vaultfs.ts";
import type { AdapterLike } from "../src/core/vaultfs.ts";

const row = (files: number, size: string, status = "Syncing"): SyncRow => ({ id: "Ab12Cd34", localPath: "C:\\v", remotePath: "/RAG", runState: "Running", status, error: "NO", size, files, dirs: 1 });
const q = (uploads: number): TransferSummary => ({ downloads: 0, downloaded: "0.00  B", downloadTotal: "0.00  B", downloadPercent: 0, uploads, uploaded: "1.00 MB", uploadTotal: "900.00 MB", uploadPercent: 0 });
const big = (progress: string, state = "ACTIVE"): TransferRow => ({ type: "⇵", tag: "77", source: "\\\\?\\C:\\v\\Lectures\\A very long lecture recording file name, week 3.pdf", destination: "/RAG/Lectures", progress, state });
const local = { files: 6772, bytes: 1.1 * 1024 ** 3, approximate: [] };

test("one large file uploading: the file count stands still, but the run is shown moving (rate, file, its %)", () => {
  const m = new ActivityMeter();
  const t = new ProgressTracker();
  let a = m.observe(0, row(3870, "500.00 MB"), local, [big("10.00%")], q(2900));
  a = m.observe(15_000, row(3870, "520.00 MB"), local, [big("40.00%")], q(2900));
  a = m.observe(30_000, row(3870, "540.00 MB"), local, [big("70.00%")], q(2900));
  assert.equal(a.stalledMs, 0);
  assert.ok(a.rate && a.rate.bytesPerSec > 1024 * 1024, "about 1.3 MB/s");
  assert.match(a.current!, /^uploading A very long lecture… ?.*week 3\.pdf \(70%\)$/);
  const p = t.update(row(3870, "540.00 MB"), q(2900), local)!;
  const text = progressText(p, a);
  assert.match(text.short, /^syncing 57% · 1\.3 MB\/s$/);
  assert.match(text.long, /Rate over the last minute: .*1\.3 MB\/s\. Now uploading .*\(70%\)\./);
});

test("nothing moves for 2 minutes: said plainly, with MEGAcmd's reason, pointing to the log", () => {
  const m = new ActivityMeter();
  const same = () => m.observe(Date.now(), row(3870, "540.00 MB"), local, [big("70.00%", "RETRYING")], q(2900));
  const t0 = 1_000_000;
  m.observe(t0, row(3870, "540.00 MB"), local, [big("70.00%", "RETRYING")], q(2900));
  const a = m.observe(t0 + STALL_MS + 5_000, row(3870, "540.00 MB"), local, [big("70.00%", "RETRYING")], q(2900));
  assert.equal(a.stalledMs, STALL_MS + 5_000);
  assert.match(a.stallReason!, /RETRYING/);
  const p = new ProgressTracker().update(row(3870, "540.00 MB"), q(2900), local)!;
  const text = progressText(p, a);
  assert.equal(text.short, "syncing 57%, no progress 2 min");
  assert.match(text.long, /No progress for 2 min: a transfer is RETRYING .*See the log in the settings/);
  // Movement again clears it.
  const b = m.observe(t0 + STALL_MS + 10_000, row(3871, "541.00 MB"), local, [], q(2899));
  assert.equal(b.stalledMs, 0);
  void same;
});

test("no transfer queued and nothing moves: the reason says MEGA's engine is scanning or comparing", () => {
  const m = new ActivityMeter();
  m.observe(0, row(100, "1.00 MB", "Pending"), local, [], null);
  const a = m.observe(STALL_MS, row(100, "1.00 MB", "Pending"), local, [], null);
  assert.match(a.stallReason!, /status is Pending with no transfer queued \(MEGA's engine is scanning or comparing\)/);
});

test("the transfer list: parsed with MEGAcmd's columns; file names shortened in the middle", () => {
  const S = COL_SEP;
  const rows = parseTransferList(`TYPE${S}TAG${S}SOURCEPATH${S}DESTINYPATH${S}PROGRESS${S}STATE\n⇵${S}12${S}C:\\v\\a.md${S}/RAG/${S}45.10%${S}ACTIVE\n`);
  assert.deepEqual(rows, [{ type: "⇵", tag: "12", source: "C:\\v\\a.md", destination: "/RAG/", progress: "45.10%", state: "ACTIVE" }]);
  assert.equal(shortName("C:\\v\\short.md"), "short.md");
  assert.equal(shortName("/x/" + "a".repeat(60) + ".pdf", 20).length, 20);
});

test("a sign-out cut short is found from MEGAcmd's real state at the next start", () => {
  const s = emptyState();
  assert.equal(interruptedSignOut(s), null, "not known yet");
  s.account = { signedIn: true };
  s.mine = { ...row(1, "1.00 MB"), runState: "Disabled" };
  const r = interruptedSignOut(s)!;
  assert.equal(r.finished, false);
  assert.equal(r.text, "The last sign-out did not finish (Obsidian closed or reloaded during it): MEGAcmd is still signed in and the sync is paused. Sign out again, or resume the sync.");
  s.account = { signedIn: false };
  assert.deepEqual(interruptedSignOut(s), { finished: true, text: "The last sign-out finished: MEGAcmd is signed out." });
});

test("the plugin's log file: appended, cut over at its size limit, never throwing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mega-route-logfile-"));
  const file = path.join(dir, "mega-route.log");
  try {
    const f = new LogFile(fs.promises as unknown as AppendFs, file, 100);
    f.add("2026-10-29 17:09:00.000 [MEGA-Route] Sign-out 1/5: the sync is paused.");
    assert.equal(await f.flush(), null);
    f.add("x".repeat(120));
    await f.flush();
    f.add("after the cut");
    await f.flush();
    assert.ok(fs.existsSync(path.join(dir, "mega-route.1.log")));
    assert.equal(fs.readFileSync(file, "utf8"), "after the cut\n");
    const bad = new LogFile(fs.promises as unknown as AppendFs, path.join(dir, "missing", "x.log"));
    bad.add("y");
    assert.ok((await bad.flush())!.length > 0, "a failure is returned, not thrown");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the plugin's log file through Obsidian's adapter: appended and cut over the same way", async () => {
  const files = new Map<string, string>();
  const adapter = {
    stat: async (p: string) => (files.has(p) ? { type: "file" as const, size: files.get(p)!.length } : null),
    exists: async (p: string) => files.has(p),
    append: async (p: string, d: string) => void files.set(p, (files.get(p) ?? "") + d),
    rename: async (a: string, b: string) => {
      if (files.has(b)) throw new Error("Destination file already exists!");
      files.set(b, files.get(a)!);
      files.delete(a);
    },
    remove: async (p: string) => void files.delete(p),
  };
  const f = new LogFile(adapterAppend(adapter as unknown as AdapterLike), ".obsidian/plugins/mega-route/mega-route.log", 100);
  f.add("first");
  assert.equal(await f.flush(), null);
  f.add("x".repeat(120));
  assert.equal(await f.flush(), null);
  f.add("second cut");
  assert.equal(await f.flush(), null);
  f.add("y".repeat(120));
  assert.equal(await f.flush(), null);
  f.add("after");
  assert.equal(await f.flush(), null, "the old .1.log is removed before the rename");
  assert.equal(files.get(".obsidian/plugins/mega-route/mega-route.log"), "after\n");
  assert.match(files.get(".obsidian/plugins/mega-route/mega-route.1.log")!, /^second cut\ny+\n$/);
});
