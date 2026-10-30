// The exclusions as MEGA rules, and .megaignore kept intact around the plugin's block.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCK_BEGIN, BLOCK_END, MEGA_DEFAULT_RULES, buildBlock, mapPattern, mergeIgnoreFile, readBlock } from "../src/core/megaignore.ts";

const rule = (p: string, cls: "-" | "+" = "-") => {
  const m = mapPattern(p, cls, ".obsidian");
  return "rule" in m ? m.rule : `PROBLEM: ${m.reason}`;
};

test("patterns as MEGA rules with exactly their meaning", () => {
  assert.equal(rule(".trash/**"), "-p:.trash");
  assert.equal(rule("node_modules/**"), "-p:node_modules");
  assert.equal(rule(".git/"), "-p:.git");
  assert.equal(rule("Drafts/old.md"), "-p:Drafts/old.md");
  assert.equal(rule("Drafts\\old"), "-p:Drafts/old");
  assert.equal(rule("**/.DS_Store"), "-n:.DS_Store");
  assert.equal(rule("**/*.tmp"), "-n:*.tmp", "a name rule sees one name, so its * cannot cross a folder");
  assert.equal(rule("Keep/**", "+"), "+p:Keep");
  // With a wildcard: a regular expression over the whole path, no backslashes needed.
  assert.equal(rule("/LaTeX/compiled/*.aux"), "-pr:LaTeX/compiled/[^/]*[.]aux");
  assert.equal(rule("LaTeX/compiled/*.run.xml"), "-pr:LaTeX/compiled/[^/]*[.]run[.]xml");
  assert.equal(rule("a/**/b.md"), "-pr:a/(.*/)?b[.]md");
  assert.equal(rule("x/a?c(1)+$^|{.md"), "-pr:x/a[^/]c[(]1[)][+][$]\\^[|][{][.]md");
});

/** What MEGA would match with a `-pr:` rule (POSIX ERE, whole path); for the constructs globToEre writes, a JavaScript
 *  regular expression anchored at both ends means the same. */
const megaMatches = (r: string, path: string) => new RegExp(`^(?:${r.replace(/^[-+][a-z]*r:/, "")})$`, "i").test(path);

test("the user's LaTeX build-output exclusions: no problem, no note, and each matches only inside its folder", () => {
  const exts = ["aux", "out", "bcf", "glo", "gls", "glg", "ist", "run.xml", "toc", "fls", "fdb_latexmk", "synctex.gz", "log", "blg", "bbl", "lof", "lot", "lol", "xdv"];
  const list = [".trash/**", "node_modules/**", ".git/**", ...exts.map((e) => `LaTeX/compiled/*.${e}`), "LaTeX/compiled/*-SAVE-ERROR", "LaTeX/compiled/code/*.tex"];
  const b = buildBlock({ configDir: ".obsidian", pluginDir: ".obsidian/plugins/mega-route", excludePatterns: list.join("\n"), includePatterns: "", syncConfigFolder: true });
  assert.deepEqual(b.problems, []);
  assert.equal(b.mapped.length, list.length);
  assert.ok(b.mapped.every((m) => !("note" in m)), "no per-line advice");
  const aux = rule("LaTeX/compiled/*.aux");
  assert.ok(megaMatches(aux, "LaTeX/compiled/main.aux"));
  assert.ok(!megaMatches(aux, "LaTeX/compiled/sub/main.aux"), "stays in compiled/, as written");
  assert.ok(!megaMatches(aux, "LaTeX/compiled/mainXaux"), "the dot is a dot");
  const tex = rule("LaTeX/compiled/code/*.tex");
  assert.ok(megaMatches(tex, "LaTeX/compiled/code/bench.tex"));
  assert.ok(!megaMatches(tex, "LaTeX/compiled/main.tex"));
  assert.ok(megaMatches(rule("LaTeX/compiled/*-SAVE-ERROR"), "LaTeX/compiled/3-introduction.tex-SAVE-ERROR"));
});

test("a * in a middle folder stays one folder (no widening, so nothing to warn about)", () => {
  const r = rule("a/*/b");
  assert.equal(r, "-pr:a/[^/]*/b");
  assert.ok(megaMatches(r, "a/x/b"));
  assert.ok(!megaMatches(r, "a/x/y/b"), "MEGA's glob -p:a/*/b would have matched this too");
  assert.ok(megaMatches(rule("a/**/b"), "a/x/y/b"), "** is the way to cross folders");
  assert.ok(megaMatches(rule("a/**/b"), "a/b"));
});

test("leaving out Obsidian's settings folder is refused (the switch does that)", () => {
  for (const p of [".obsidian", ".obsidian/", ".obsidian/**"]) assert.match(rule(p), /PROBLEM: would leave out Obsidian's settings folder/, p);
  assert.equal(rule(".obsidian/snippets/**"), "-p:.obsidian/snippets");
  assert.equal(rule(".obsidian", "+"), "+p:.obsidian");
});

test("patterns that cannot be written are reported, never written", () => {
  for (const p of ["*", "**", "**/*", "/**", "*/"]) assert.match(rule(p), /PROBLEM: would leave out the whole vault/, p);
  assert.match(rule("/"), /PROBLEM: is empty/);
  assert.match(rule("a\u0000b"), /PROBLEM: contains a control character/);
  assert.match(rule("x".repeat(600)), /PROBLEM: is longer than 512/);
  const b = buildBlock({ configDir: ".obsidian", pluginDir: ".obsidian/plugins/mega-route", excludePatterns: "ok/**\n*\n# a comment\n\n", includePatterns: "", syncConfigFolder: false });
  assert.deepEqual(b.problems.map((p) => p.pattern), ["*"]);
  assert.ok(b.rules.includes("-p:ok"));
  assert.ok(!b.rules.some((r) => r.endsWith(":*")));
});

test("the block: config folder first, the user's rules, the fixed rules last", () => {
  const b = buildBlock({ configDir: ".obsidian", pluginDir: ".obsidian/plugins/mega-route", excludePatterns: ".trash/**\nPrivate/**", includePatterns: "Private/shared/**", syncConfigFolder: true });
  assert.equal(b.rules[0], "+dN:.obsidian");
  assert.deepEqual(b.rules.slice(1, 4), ["-p:.trash", "-p:Private", "+p:Private/shared"]);
  assert.deepEqual(b.rules.slice(-b.fixed.length), b.fixed);
  assert.ok(b.fixed.includes("-p:.obsidian/workspace*"));
  assert.ok(b.fixed.includes("-p:.obsidian/plugins/mega-route"));
  assert.ok(b.fixed.includes("-p:.obsidian/plugins/mega-sync-fork"), "the folder of versions up to 3.0.1 is kept out too");
  const renamed = buildBlock({ configDir: ".obsidian", pluginDir: ".obsidian/plugins/my-copy", excludePatterns: "", includePatterns: "", syncConfigFolder: false });
  assert.ok(renamed.fixed.includes("-p:.obsidian/plugins/my-copy"), "the folder comes from the manifest, so a renamed folder is kept out");
  assert.ok(b.fixed.includes("-p:.trash"));
  assert.ok(b.fixed.includes("-fN:_mega_sync_snapshot.json"));
  assert.ok(b.fixed.includes("-N:.mega-sync-bin"));
  const off = buildBlock({ configDir: ".config", pluginDir: ".config/plugins/x", excludePatterns: "", includePatterns: "", syncConfigFolder: false });
  assert.ok(!off.rules.some((r) => r.startsWith("+")));
  assert.ok(off.rules.includes("-p:.config/workspace*"));
});

test("a fresh .megaignore gets MEGA's defaults above the block", () => {
  const text = mergeIgnoreFile(null, ["-p:x"]);
  assert.equal(text, [...MEGA_DEFAULT_RULES, "", BLOCK_BEGIN, "-p:x", BLOCK_END, ""].join("\n"));
});

test("an existing .megaignore: the user's lines kept byte for byte, CRLF and BOM kept, the block replaced", () => {
  const bom = String.fromCharCode(0xfeff);
  const user = bom + "-:Thumbs.db\r\n-:.*\r\n# mine\r\n-p:*Private/Templates";
  const once = mergeIgnoreFile(user, ["-p:a"]);
  assert.equal(once, bom + "-:Thumbs.db\r\n-:.*\r\n# mine\r\n-p:*Private/Templates\r\n\r\n" + BLOCK_BEGIN + "\r\n-p:a\r\n" + BLOCK_END + "\r\n");
  const twice = mergeIgnoreFile(once, ["-p:b", "-p:c"]);
  assert.equal(twice, bom + "-:Thumbs.db\r\n-:.*\r\n# mine\r\n-p:*Private/Templates\r\n\r\n" + BLOCK_BEGIN + "\r\n-p:b\r\n-p:c\r\n" + BLOCK_END + "\r\n");
  assert.deepEqual(readBlock(twice), ["-p:b", "-p:c"]);
  assert.equal(mergeIgnoreFile(twice, ["-p:b", "-p:c"]), twice, "unchanged rules leave the file unchanged");
  assert.equal(readBlock("-:x\n"), null);
});

test("a block moved to the middle by hand is taken out and put back at the end", () => {
  const text = `-:a\n${BLOCK_BEGIN}\n-p:old\n${BLOCK_END}\n-:b\n`;
  assert.equal(mergeIgnoreFile(text, ["-p:new"]), `-:a\n-:b\n\n${BLOCK_BEGIN}\n-p:new\n${BLOCK_END}\n`);
});
