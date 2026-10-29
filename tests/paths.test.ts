// Checks on paths and ids before they reach MEGAcmd, including hostile values.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLocalFolder, checkRemoteFolder, checkSyncId, isInside, isRemoteInside, normaliseLocal, sameLocal, sameRemote } from "../src/core/paths.ts";
import { checkClientPath, defaultClient, pathsFor, processLister } from "../src/core/locate.ts";

test("good MEGA folders", () => {
  for (const [input, value] of [
    ["/RAG", "/RAG"],
    [" /RAG/ ", "/RAG"],
    ["/Notes/My Vault", "/Notes/My Vault"],
    ["/Ünïcode & co", "/Ünïcode & co"],
  ]) {
    const c = checkRemoteFolder(input);
    assert.equal(c.ok, true, input);
    if (c.ok) assert.equal(c.value, value);
  }
});

test("hostile or wrong MEGA folders are refused, each with a reason", () => {
  const bad = [
    '/RAG" -d "Ab12Cd34', // would split into extra arguments on MEGAcmd's server
    "/RAG\n/Other",
    "/RAG\u0000",
    "/RAG" + String.fromCharCode(0x2028) + "x",
    "//bin/RAG", // the Rubbish Bin
    "//in/Backups", // the Vault
    "RAG",
    "/",
    "",
    "/a//b",
    "/a/../b",
    "/./a",
    "/-d",
    "/a/-p",
    "/RAG\\sub",
    "/ RAG",
    "/" + "x".repeat(1100),
    42,
    null,
  ];
  for (const b of bad) {
    const c = checkRemoteFolder(b);
    assert.equal(c.ok, false, JSON.stringify(b));
    if (!c.ok) assert.ok(c.reason.length > 10);
  }
});

test("local folders", () => {
  assert.equal(checkLocalFolder("C:\\Users\\me\\Documents\\MEGA\\RAG", true).ok, true);
  assert.equal(checkLocalFolder("C:\\a & b ; c", true).ok, true, "shell characters are fine: no shell is involved");
  assert.equal(checkLocalFolder("\\\\server\\share\\vault", true).ok, true);
  assert.equal(checkLocalFolder("/home/me/vault", false).ok, true);
  for (const [p, win] of [
    ['C:\\a" -d "b', true],
    ["C:\\a\nb", true],
    ["relative\\path", true],
    ["-C:\\x", true],
    ["vault", false],
    ["", true],
  ] as [string, boolean][]) {
    assert.equal(checkLocalFolder(p, win).ok, false, JSON.stringify(p));
  }
});

test("sync ids", () => {
  assert.equal(checkSyncId("Ab12Cd34").ok, true);
  assert.equal(checkSyncId("WOOmFwZfQwM").ok, true);
  for (const b of ["-d", "a b", "x;y", "", "a".repeat(65), 5]) assert.equal(checkSyncId(b).ok, false, String(b));
});

test("comparing local folders", () => {
  assert.equal(normaliseLocal("\\\\?\\C:\\Users\\Me\\RAG\\", true), "c:\\users\\me\\rag");
  assert.equal(normaliseLocal("//?/C:/Users/Me/RAG", true), "c:\\users\\me\\rag");
  assert.equal(sameLocal("\\\\?\\C:\\Users\\Me\\RAG", "c:/users/me/rag", true), true);
  assert.equal(sameLocal("/home/a/RAG", "/home/a/rag", false), false);
  assert.equal(isInside("C:\\a\\b", "C:\\a", true), true);
  assert.equal(isInside("C:\\ab", "C:\\a", true), false);
  assert.equal(isInside("C:\\a", "C:\\a", true), false);
  assert.equal(sameRemote("/RAG/", "/RAG"), true);
  assert.equal(sameRemote("/rag", "/RAG"), false);
  assert.equal(isRemoteInside("/RAG/x", "/RAG"), true);
  assert.equal(isRemoteInside("/RAGx", "/RAG"), false);
});

test("where MEGAcmd is, and the check on a client path", async () => {
  const win = { os: "windows" as const, env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", SystemRoot: "C:\\Windows" }, home: "C:\\Users\\me" };
  assert.equal(defaultClient(win), "C:\\Users\\me\\AppData\\Local\\MEGAcmd\\MegaClient.exe");
  assert.deepEqual(pathsFor(win, "C:\\Users\\me\\AppData\\Local\\MEGAcmd\\MegaClient.exe"), {
    client: "C:\\Users\\me\\AppData\\Local\\MEGAcmd\\MegaClient.exe",
    log:"C:\\Users\\me\\AppData\\Local\\MEGAcmd\\.megaCmd\\megacmdserver.log",
  });
  assert.deepEqual(processLister(win), { program: "C:\\Windows\\System32\\tasklist.exe", args: ["/FI", "IMAGENAME eq MEGA*", "/FO", "CSV", "/NH"] });
  assert.equal(processLister({ ...win, env: { SystemRoot: "relative" } }), null);
  assert.equal(defaultClient({ ...win, env: {} }), null);
  const linux = { os: "linux" as const, env: {}, home: "/home/me" };
  assert.equal(defaultClient(linux), "/usr/bin/mega-exec");
  assert.equal(pathsFor(linux, "/usr/bin/mega-exec").log, "/home/me/.megaCmd/megacmdserver.log");

  const exists = async () => ({ isFile: () => true });
  const missing = async () => {
    throw new Error("ENOENT");
  };
  const vault = "C:\\Users\\me\\Documents\\MEGA\\RAG";
  assert.equal((await checkClientPath(win, "C:\\Tools\\MEGAcmd\\MegaClient.exe", vault, exists)).ok, true);
  assert.equal((await checkClientPath(win, "C:\\Tools\\MEGAcmd\\megaclient.EXE", vault, exists)).ok, true);
  for (const bad of [
    "C:\\Windows\\System32\\cmd.exe", // not MEGAcmd's client
    "C:\\Tools\\mega-sync.bat",
    "MegaClient.exe", // not absolute
    "C:\\Users\\me\\Documents\\MEGA\\RAG\\tools\\MegaClient.exe", // inside the vault
    'C:\\x"\\MegaClient.exe',
    "",
  ]) {
    assert.equal((await checkClientPath(win, bad, vault, exists)).ok, false, bad);
  }
  assert.equal((await checkClientPath(win, "C:\\Tools\\MegaClient.exe", vault, missing)).ok, false);
  // MEGAcmd's folder instead of its client: the client's name is added, and the result checked as before.
  const folderThenFile = async (p: string) => ({ isFile: () => p.endsWith(".exe"), isDirectory: () => !p.endsWith(".exe") });
  assert.deepEqual(await checkClientPath(win, "C:\\Users\\me\\AppData\\Local\\MEGAcmd", vault, folderThenFile), { ok: true, path: "C:\\Users\\me\\AppData\\Local\\MEGAcmd\\MegaClient.exe" });
  assert.equal((await checkClientPath(win, "C:\\Users\\me\\Documents\\MEGA\\RAG\\tools", vault, folderThenFile)).ok, false, "a folder inside the vault is refused");
  assert.equal((await checkClientPath(linux, "/usr/bin/mega-exec", "/home/me/vault", exists)).ok, true);
  assert.equal((await checkClientPath(linux, "/usr/bin/bash", "/home/me/vault", exists)).ok, false);
});
