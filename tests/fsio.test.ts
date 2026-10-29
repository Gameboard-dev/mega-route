// Writing a hidden file in place (MEGA marks .megaignore hidden): on Windows with a real hidden file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeFailure, writeInPlace } from "../src/core/fsio.ts";
import type { WriteFs } from "../src/core/fsio.ts";

const windows = process.platform === "win32";
const attrib = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "attrib.exe");
/** Sets or reads the hidden attribute with Windows' attrib (test setup only; the plugin never runs it). */
const hide = (p: string) => execFileSync(attrib, ["+h", p], { windowsHide: true });
/** attrib prints the attribute letters, then the path ("A    H        C:\...\.megaignore"). */
const isHidden = (p: string) => {
  const out = execFileSync(attrib, [p], { windowsHide: true, encoding: "utf8" });
  const at = out.toLowerCase().indexOf(p.toLowerCase());
  return out.slice(0, at < 0 ? 20 : at).includes("H");
};
const wfs = fs.promises as unknown as WriteFs;

test("a hidden .megaignore: plain writeFile fails with EPERM, writing in place succeeds and keeps it hidden", { skip: !windows && "Windows only" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mega-route-hidden-"));
  const file = path.join(dir, ".megaignore");
  try {
    fs.writeFileSync(file, "-:Thumbs.db\r\n-:.*\r\n");
    hide(file);
    assert.ok(isHidden(file), "set up as hidden");
    assert.throws(() => fs.writeFileSync(file, "x"), (e: NodeJS.ErrnoException) => e.code === "EPERM", "the reported bug: writeFile cannot replace a hidden file");
    const text = "-:Thumbs.db\r\n-:.*\r\n\r\n# BEGIN MEGA-Route\r\n-p:.trash\r\n# END MEGA-Route\r\n";
    await writeInPlace(wfs, file, text);
    assert.equal(fs.readFileSync(file, "utf8"), text);
    assert.ok(isHidden(file), "still hidden");
    await writeInPlace(wfs, file, "short\n");
    assert.equal(fs.readFileSync(file, "utf8"), "short\n", "a shorter text cuts the rest off");
    assert.ok(isHidden(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing file is created; writing does not follow the 'w' flag anywhere", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mega-route-new-"));
  const file = path.join(dir, ".megaignore");
  try {
    await writeInPlace(wfs, file, "-:x\n");
    assert.equal(fs.readFileSync(file, "utf8"), "-:x\n");
    const opened: string[] = [];
    const spy: WriteFs = { open: (p, f) => (opened.push(f), wfs.open(p, f)), readFile: (p) => wfs.readFile(p) };
    await writeInPlace(spy, file, "-:y\n");
    assert.deepEqual(opened, ["r+"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bytes read back differently are reported; failures say what to do", async () => {
  const fake: WriteFs = {
    open: async () => ({ write: async (_b, _o, l) => ({ bytesWritten: l }), truncate: async () => undefined, datasync: async () => undefined, close: async () => undefined }),
    readFile: async () => new TextEncoder().encode("something else"),
  };
  await assert.rejects(writeInPlace(fake, "C:\\v\\.megaignore", "-:x\n"), /does not hold what was written/);
  const msg = writeFailure("C:\\v\\.megaignore", Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }));
  assert.match(msg, /Could not write C:\\v\\.megaignore/);
  assert.match(msg, /Read-only/);
  assert.match(writeFailure("x", Object.assign(new Error("busy"), { code: "EBUSY" })), /Wait a moment/);
});
