// The log buffer and the reader that follows MEGAcmd's log file.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LogBuffer, LogTail, formatLine } from "../src/core/log.ts";

test("the buffer keeps the last lines and tells its listeners", () => {
  const b = new LogBuffer(10);
  const seen: string[] = [];
  const off = b.subscribe((added) => seen.push(...added.map((l) => l.text)));
  for (let i = 0; i < 25; i++) b.add("plugin", "info", `line ${i}`);
  assert.equal(b.all().length, 10);
  assert.equal(b.all()[0].text, "line 15");
  assert.equal(seen.length, 25);
  b.add("megacmd", "warn", "a\nb\r\n\nc");
  assert.deepEqual(b.all().slice(-3).map((l) => l.text), ["a", "b", "c"]);
  off();
  b.add("plugin", "info", "after");
  assert.equal(seen.length, 28);
  assert.match(formatLine({ t: new Date(2026, 0, 1, 9, 5, 7).getTime(), source: "megacmd", level: "warn", text: "x" }), /^09:05:07 \[MEGAcmd WARN\] x$/);
});

test("the tail: last part first, then what is added, whole lines only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mega-route-tail-"));
  const file = path.join(dir, "megacmdserver.log");
  try {
    const t = new LogTail(fs.promises, file, 20);
    assert.deepEqual(await t.poll(), { lines: [], missing: true, skipped: 0, restarted: false });
    fs.writeFileSync(file, "old line one\nold line two\nlast old line\n");
    let r = await t.poll();
    assert.deepEqual(r.lines, ["last old line"], "only the last 20 bytes at first (the cut line is dropped with the rest)");
    fs.appendFileSync(file, "new 1\nnew 2 part");
    r = await t.poll();
    assert.deepEqual(r.lines, ["new 1"]);
    fs.appendFileSync(file, "ial\r\nnew 3\n");
    r = await t.poll();
    assert.deepEqual(r.lines, ["new 2 partial", "new 3"]);
    assert.deepEqual((await t.poll()).lines, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the tail: a rotated (shorter) file is read from its start; a burst beyond the limit is skipped and said", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mega-route-tail-"));
  const file = path.join(dir, "megacmdserver.log");
  try {
    fs.writeFileSync(file, "a long first file with many characters in it\n");
    const t = new LogTail(fs.promises, file, 1000, 100);
    await t.poll();
    fs.writeFileSync(file, "rotated\n");
    let r = await t.poll();
    assert.equal(r.restarted, true);
    assert.deepEqual(r.lines, ["rotated"]);
    fs.appendFileSync(file, "x".repeat(300) + "\nend\n");
    r = await t.poll();
    assert.ok(r.skipped > 0);
    assert.deepEqual(r.lines.at(-1), "end");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
