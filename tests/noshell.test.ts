// No shell, no string commands, no eval: checked in the sources and in the built main.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ProcessRunner } from "../src/core/runner.ts";
import type { ChildProcessApi } from "../src/core/runner.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));
}

test("the sources start processes only through runner.ts, never with a shell or eval", () => {
  for (const f of files(path.join(root, "src"))) {
    const text = fs.readFileSync(f, "utf8");
    const rel = path.relative(root, f);
    assert.doesNotMatch(text, /shell:\s*true/, rel);
    assert.doesNotMatch(text, /\b(execSync|execFileSync|spawnSync)\b/, rel);
    assert.doesNotMatch(text, /\bcp\.exec\(|\.exec\(\s*["'`]/, rel);
    assert.doesNotMatch(text, /\beval\(|new Function\(/, rel);
    assert.doesNotMatch(text, /cmd(\.exe)?["'`]?\s*,\s*\[\s*["'`]\/[cCkK]/, rel);
    if (!rel.endsWith(path.join("core", "runner.ts")) && !rel.endsWith("node.ts")) {
      assert.doesNotMatch(text, /\.(execFile|spawn)\(/, `${rel} starts a process outside runner.ts`);
    }
  }
});

test("the built main.js has no shell use and no eval", () => {
  const main = path.join(root, "main.js");
  if (!fs.existsSync(main)) return;
  const text = fs.readFileSync(main, "utf8");
  assert.doesNotMatch(text, /shell:\s*true/);
  assert.doesNotMatch(text, /\b(execSync|execFileSync|spawnSync)\b/);
  assert.doesNotMatch(text, /\beval\(|new Function\(/);
  assert.match(text, /shell: false/);
});

test("the runner passes shell: false, a time limit and an output cap, and the arguments as an array", async () => {
  const seen: unknown[] = [];
  const fake: ChildProcessApi = {
    execFile: (file, args, options, cb) => {
      seen.push({ file, args, options });
      cb(null, "out", "");
      return undefined;
    },
    spawn: (file, args, options) => {
      seen.push({ file, args, options });
      const handlers: Record<string, (...a: unknown[]) => void> = {};
      setTimeout(() => handlers.close?.(0, null), 5);
      return {
        stdin: { write: () => true, end: () => undefined, on: () => undefined },
        stdout: { on: () => undefined },
        stderr: { on: () => undefined },
        on: (event: string, f: (...a: unknown[]) => void) => {
          handlers[event] = f;
          return undefined;
        },
        kill: () => undefined,
      } as never;
    },
  };
  const r = new ProcessRunner(fake, "C:\\MEGAcmd\\MegaClient.exe", [], { PATH: "x", MEGACMD_DO_NOT_REDACT_LINES: "1", megacmd_do_not_redact_lines: "1" });
  const res = await r.run(["sync", 'a " b & c'], 1234);
  assert.equal(res.code, 0);
  const call = seen[0] as { file: string; args: string[]; options: Record<string, unknown> };
  assert.equal(call.file, "C:\\MEGAcmd\\MegaClient.exe");
  assert.deepEqual(call.args, ["sync", 'a " b & c']);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.timeout, 1234);
  assert.equal(call.options.windowsHide, true);
  assert.ok((call.options.maxBuffer as number) > 0);
  assert.deepEqual(call.options.env, { PATH: "x" }, "MEGACMD_DO_NOT_REDACT_LINES is never passed to MEGAcmd");
  const ir = await r.runInteractive(["login", "a@b.org", "pw"], 1000, () => undefined);
  assert.equal(ir.code, 0);
  const open = seen[1] as { args: string[]; options: Record<string, unknown> };
  assert.deepEqual(open.args, ["login", "a@b.org", "pw"]);
  assert.equal(open.options.shell, false);
  assert.equal(open.options.windowsHide, true, "no window is ever shown");
  assert.equal("detached" in open.options, false);
  assert.deepEqual(open.options.env, { PATH: "x" });
});

test("no window or terminal is ever opened: no detached processes, no MEGAcmdShell, no terminal programs", () => {
  for (const f of files(path.join(root, "src"))) {
    const text = fs.readFileSync(f, "utf8");
    const rel = path.relative(root, f);
    assert.doesNotMatch(text, /detached\s*:/, rel);
    assert.doesNotMatch(text, /MEGAcmdShell|wt\.exe|cmd\.exe|powershell|x-terminal-emulator|Terminal\.app/i, rel);
  }
});
