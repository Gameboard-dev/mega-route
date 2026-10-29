// Moving the 2.x settings to version 3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEVICE, LEGACY_CREDENTIAL_KEYS, SETTINGS_VERSION, migrate, readDevice, withoutCredentials } from "../src/core/settings.ts";

/** The shape of a 2.x data.json (values made up). */
function v2(): Record<string, unknown> {
  return {
    email: "someone@example.com",
    password: "not-a-real-password",
    secondFactorCode: "",
    session: { key: "k", sid: "s", name: "n", user: "u" },
    baseFolder: "RAG",
    remoteSubFolder: "",
    secretsEncrypted: false,
    secretsBlob: null,
    settingsPassword: "",
    syncOnStartup: false,
    syncDirection: "upload-only",
    excludePatterns: ".trash/**\nLaTeX/compiled/*.aux",
    includePatterns: "",
    ignorePathsRegex: "",
    onlyAllowPathsRegex: "^Notes/",
    syncVaultConfig: true,
    showStatusBar: true,
    showRibbon: false,
    parallelUploads: 4,
    knownBaseHandle: "abc",
    lastSnapshot: { v: 2, files: { "a.md": { size: 1 } } },
    megaSyncLog: ["line 1", "line 2"],
  };
}

test("2.x settings: what applies is carried over, the rest set aside, the sign-in data removed and copied nowhere", () => {
  const m = migrate(v2(), "RAG");
  assert.equal(m.migrated, true);
  assert.equal(m.settings.settingsVersion, SETTINGS_VERSION);
  assert.equal(m.settings.remoteFolder, "/RAG");
  assert.equal(m.settings.excludePatterns, ".trash/**\nLaTeX/compiled/*.aux");
  assert.equal(m.settings.syncConfigFolder, true);
  assert.equal(m.settings.showRibbon, false);
  for (const k of LEGACY_CREDENTIAL_KEYS) assert.equal(k in m.data, false, `${k} is removed from data.json`);
  assert.equal(m.credentialsRemoved, true);
  assert.ok(m.notes.includes("Removed the sign-in data version 2 stored in data.json (3.x never uses it; MEGAcmd keeps its own session)."));
  assert.ok(!JSON.stringify(m).includes("not-a-real-password"), "the password is nowhere in the result");
  assert.equal("lastSnapshot" in m.data, false);
  assert.equal("syncDirection" in m.data, false);
  assert.deepEqual(m.dropped!.lastSnapshot, v2().lastSnapshot);
  assert.deepEqual(m.dropped!.megaSyncLog, ["line 1", "line 2"]);
  for (const k of LEGACY_CREDENTIAL_KEYS) assert.equal(k in m.dropped!, false, `${k} is not copied into the backup`);
  assert.ok(m.notes.some((n) => n.includes("onlyAllowPathsRegex")));
});

test("a 2.x sub-folder becomes part of the MEGA folder", () => {
  assert.equal(migrate({ baseFolder: "/Obsidian/", remoteSubFolder: "Work" }, "x").settings.remoteFolder, "/Obsidian/Work");
});

test("version 3 data loads as it is, and a second load changes nothing", () => {
  const first = migrate(v2(), "RAG");
  const second = migrate(first.data, "RAG");
  assert.equal(second.migrated, false);
  assert.equal(second.dropped, null);
  assert.deepEqual(second.data, first.data);
});

test("a fresh install: the MEGA folder is named after the vault", () => {
  const m = migrate(null, "My Vault");
  assert.equal(m.migrated, false);
  assert.equal(m.settings.remoteFolder, "/My Vault");
  assert.equal(m.credentialsRemoved, false);
  assert.equal(migrate(undefined, '"/\\').settings.remoteFolder, "/Obsidian");
});

test("wrong types in data.json fall back to the defaults", () => {
  const m = migrate({ settingsVersion: 3, remoteFolder: 5, showStatusBar: "yes", logFilter: "bad" }, "V");
  assert.equal(m.settings.remoteFolder, "/V");
  assert.equal(m.settings.showStatusBar, true);
  assert.equal(m.settings.logFilter, "all");
});

test("per-device settings", () => {
  assert.deepEqual(readDevice(null), DEFAULT_DEVICE);
  assert.deepEqual(readDevice({ clientPath: "C:\\x\\MegaClient.exe", startServerOnLoad: true, idlePollSeconds: 2 }), { clientPath: "C:\\x\\MegaClient.exe", startServerOnLoad: true, idlePollSeconds: 10, logWrap: true });
  assert.equal(readDevice({ idlePollSeconds: 99999 }).idlePollSeconds, 600);
});

test("3.x data.json still holding 2.x sign-in data: removed at load, every other setting untouched", () => {
  const v3 = { ...migrate(v2(), "RAG").data, remoteFolder: "/Elsewhere", excludePatterns: "a/**", logFilter: "sync" };
  const withOld = { email: "someone@example.com", password: "not-a-real-password", session: { sid: "s" }, secretsEncrypted: false, settingsPassword: "", ...v3 };
  const m = migrate(withOld, "RAG");
  assert.equal(m.credentialsRemoved, true);
  assert.equal(m.migrated, false);
  assert.deepEqual(m.data, v3, "the other settings are exactly as they were");
  assert.equal(migrate(m.data, "RAG").credentialsRemoved, false, "once removed, nothing more to do");
});

test("the backup of 2.x settings is cleaned of sign-in data too", () => {
  const { rest, removed } = withoutCredentials({ password: "x", email: "y", lastSnapshot: { v: 2 }, syncDirection: "upload-only" });
  assert.equal(removed, true);
  assert.deepEqual(rest, { lastSnapshot: { v: 2 }, syncDirection: "upload-only" });
  assert.equal(withoutCredentials({ a: 1 }).removed, false);
});

test("the log pane's wrap setting: on by default, per device", () => {
  assert.equal(readDevice(null).logWrap, true);
  assert.equal(readDevice({ logWrap: false }).logWrap, false);
  assert.equal(readDevice({ logWrap: "no" }).logWrap, true);
});
