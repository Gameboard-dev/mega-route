// The controller against a fake MEGAcmd: detection, the states, the checks before creating a sync, the argument
// arrays of every action, hostile paths, and time limits.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { rig, IGNORE_OPTIONS } from "./helpers.ts";
import { describe as shown } from "../src/core/status.ts";
import { BLOCK_BEGIN } from "../src/core/megaignore.ts";
import { TIMEOUT } from "../src/core/controller.ts";

test("MEGAcmd not installed: nothing is run, the state says so", async () => {
  const r = rig({ noClient: true });
  try {
    const s = await r.controller.refresh(true);
    assert.equal(s.client.found, false);
    assert.equal(r.calls().length, 0);
    const d = shown(s);
    assert.equal(d.level, "off");
    assert.equal(d.short, "MEGAcmd not found");
    assert.match(d.long, /MegaClient\.exe/);
  } finally {
    r.cleanup();
  }
});

test("server not running: MEGAcmd is asked nothing (its client would start the server)", async () => {
  const r = rig({ processes: ["MEGAsync.exe"] });
  try {
    const s = await r.controller.refresh(true);
    assert.equal(s.server, "stopped");
    assert.equal(s.desktopApp, "running");
    assert.deepEqual(r.calls(), []);
    assert.equal(shown(s).short, "MEGAcmd not running");
  } finally {
    r.cleanup();
  }
});

test("the process list cannot be read: status unknown, MEGAcmd asked nothing", async () => {
  const r = rig({ processesFail: true });
  try {
    const s = await r.controller.refresh(true);
    assert.equal(s.server, "unknown");
    assert.deepEqual(r.calls(), []);
    assert.equal(shown(s).level, "attention");
  } finally {
    r.cleanup();
  }
});

test("not signed in", async () => {
  const r = rig({ state: { loggedIn: false } });
  try {
    const s = await r.controller.refresh(true);
    assert.equal(s.account.signedIn, false);
    assert.equal(shown(s).short, "not signed in");
    assert.deepEqual(r.calls(), [["version"], ["whoami"]]);
  } finally {
    r.cleanup();
  }
});

test("signed in, no sync: the account is masked, the version read", async () => {
  const r = rig();
  try {
    const s = await r.controller.refresh(true);
    assert.equal(s.account.signedIn, true);
    assert.equal(s.account.masked, "s***@e***.com");
    assert.equal(s.client.version, "2.1.1.0");
    assert.equal(s.mine, null);
    assert.equal(shown(s).short, "no sync");
    assert.ok(!r.logs.some((l) => l.text.includes("someone@example.com")), "the full address is never logged");
    const list = r.calls().find((c) => c[0] === "sync")!;
    assert.deepEqual(list, ["sync", "--path-display-size=4096", "--col-separator=~|~", "--output-cols=ID,LOCALPATH,REMOTEPATH,RUN_STATE,STATUS,ERROR,SIZE,FILES,DIRS"]);
  } finally {
    r.cleanup();
  }
});

function withSync(vault: string, extra: Record<string, unknown> = {}) {
  return { loggedIn: true, email: "a@b.org", folders: { "/RAG": ["x.md"] }, syncs: [{ id: "Ab12Cd34", local: vault, remote: "/RAG", runState: "Running", status: "Synced", error: "NO", size: "12.00 MB", files: 6784, dirs: 666, ...extra }] };
}

test("each sync state is read and shown", async () => {
  const r = rig();
  try {
    const cases: [Record<string, unknown>, string, string][] = [
      [{}, "ok", "synced"],
      [{ runState: "Disabled" }, "paused", "paused"],
      [{ runState: "Suspended" }, "paused", "paused"],
      [{ runState: "Loading", status: "NONE" }, "busy", "starting"],
      [{ status: "Pending" }, "busy", "scanning"],
      [{ status: "Processing" }, "busy", "scanning"],
      [{ error: "LOCAL_PATH_UNAVAILABLE" }, "error", "error: LOCAL_PATH_UNAVAILABLE"],
    ];
    for (const [extra, level, short] of cases) {
      r.setState(withSync(r.vault, extra));
      const s = await r.controller.refresh(false);
      assert.ok(s.mine, `the vault's sync is found (${JSON.stringify(extra)})`);
      const d = shown(s);
      assert.equal(d.level, level, JSON.stringify(extra));
      assert.ok(d.short.startsWith(short), `${d.short} for ${JSON.stringify(extra)}`);
    }
    const s = await r.controller.refresh(false);
    assert.equal(s.mine!.files, 6784);
    assert.equal(s.mine!.dirs, 666);
    assert.equal(s.mine!.size, "12.00 MB");
  } finally {
    r.cleanup();
  }
});

test("syncing: transfers are asked and counted", async () => {
  const r = rig();
  try {
    r.setState({
      ...withSync(r.vault, { status: "Syncing" }),
      transfers: { downloads: 2, downloaded: "1.00 MB", downloadTotal: "4.00 MB", downloadPct: "25.00", uploads: 10, uploaded: "3.00 MB", uploadTotal: "4.00 MB", uploadPct: "75.00" },
    });
    const s = await r.controller.refresh(false);
    assert.ok(r.calls().some((c) => c.join(" ") === "transfers --summary"));
    assert.equal(r.calls().at(-1)!.slice(0, 3).join(" "), "transfers --show-syncs --limit=3", "then the sync's running transfers, for 'uploading <name>'");
    assert.equal(s.transfers!.uploads, 10);
    assert.equal(s.transfers!.downloads, 2);
    // Without the vault's file count yet: the queue as counts, no percentage (the queue's own totals jump about).
    const d = shown(s);
    assert.equal(d.level, "busy");
    assert.equal(d.short, "syncing: 10 files to upload");
    assert.match(d.long, /10 files to upload, 2 files to download/);
    assert.equal(d.progress, null);
  } finally {
    r.cleanup();
  }
});

test("sync issues: listed with their reason", async () => {
  const r = rig();
  try {
    r.setState({ ...withSync(r.vault, { error: "Sync Issues (1)", status: "Pending" }), issues: [{ id: "I1", sync: "Ab12Cd34", reason: "Local and remote changed since last synced" }] });
    const s = await r.controller.refresh(false);
    assert.equal(s.issues.length, 1);
    const d = shown(s);
    assert.equal(d.level, "attention");
    assert.equal(d.short, "1 sync issue");
    assert.match(d.long, /Local and remote changed/);
  } finally {
    r.cleanup();
  }
});

test("the vault's sync is matched by its folder, whatever the case or \\\\?\\ prefix", async () => {
  const r = rig();
  try {
    r.setState(withSync(r.vault.toUpperCase()));
    const s = await r.controller.refresh(false);
    assert.ok(s.mine);
    r.setState({ loggedIn: true, email: "a@b.org", syncs: [{ id: "Other1", local: path.join(r.dir, "Elsewhere"), remote: "/Other" }] });
    const s2 = await r.controller.refresh(false);
    assert.equal(s2.mine, null);
    assert.equal(s2.syncs.length, 1);
  } finally {
    r.cleanup();
  }
});

test("pause, resume and remove: the exact argument arrays, by the sync's id", async () => {
  const r = rig();
  try {
    r.setState(withSync(r.vault));
    await r.controller.refresh(false);
    const before = r.calls().length;
    assert.equal((await r.controller.change("pause")).ok, true);
    assert.equal(r.state().syncs![0].runState, "Disabled");
    assert.equal((await r.controller.change("resume")).ok, true);
    assert.equal(r.state().syncs![0].runState, "Running");
    assert.equal((await r.controller.change("remove")).ok, true);
    assert.equal(r.state().syncs!.length, 0);
    const actions = r.calls().slice(before).filter((c) => c[0] === "sync" && c.length === 3);
    assert.deepEqual(actions, [
      ["sync", "-p", "Ab12Cd34"],
      ["sync", "-e", "Ab12Cd34"],
      ["sync", "-d", "Ab12Cd34"],
    ]);
    assert.ok(r.logs.some((l) => /no file was deleted/.test(l.text)));
  } finally {
    r.cleanup();
  }
});

test("an id MEGAcmd would read as an option is never passed on: the vault's folder names the sync instead", async () => {
  const r = rig();
  try {
    r.setState({ ...withSync(r.vault), syncs: [{ id: "-d x", local: r.vault, remote: "/RAG" }] });
    await r.controller.refresh(false);
    const res = await r.controller.change("pause");
    assert.equal(res.ok, true, res.message);
    assert.deepEqual(r.calls().filter((c) => c[0] === "sync" && c[1] === "-p"), [["sync", "-p", r.vault]]);
    assert.ok(!r.calls().some((c) => c.includes("-d x")));
  } finally {
    r.cleanup();
  }
});

test("create: checks, .megaignore written first, then sync <vault> <folder>", async () => {
  const r = rig({ ignore: "-:Thumbs.db\r\n-:.*\r\n-p:*Private/Templates\r\n" });
  try {
    const plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    assert.equal(plan.ok, true, plan.blockers.join("; "));
    assert.equal(plan.remoteExists, true);
    assert.equal(plan.remoteCount, 0);
    assert.equal(r.ignore(), "-:Thumbs.db\r\n-:.*\r\n-p:*Private/Templates\r\n", "the checks change nothing");
    const res = await r.controller.create(plan, IGNORE_OPTIONS);
    assert.equal(res.ok, true, res.message);
    const i = r.events.indexOf("ignore-write");
    const add = r.calls().findIndex((c) => c[0] === "sync" && c.length === 3 && !c[1].startsWith("-"));
    assert.ok(i >= 0 && add >= 0);
    assert.ok(r.events.indexOf("ignore-write") < r.events.lastIndexOf("sync"), ".megaignore is written before the sync is created");
    assert.deepEqual(r.calls()[add], ["sync", r.vault, "/RAG"]);
    const text = r.ignore()!;
    assert.ok(text.startsWith("-:Thumbs.db\r\n-:.*\r\n-p:*Private/Templates\r\n"), "the user's rules are kept");
    assert.ok(text.includes(BLOCK_BEGIN));
    assert.ok(text.includes("\r\n+dN:.obsidian\r\n"));
    assert.ok(text.includes("-p:.obsidian/plugins/mega-route"));
    assert.ok(r.controller.state.mine, "the new sync is listed");
  } finally {
    r.cleanup();
  }
});

test("create with a hidden .megaignore (as MEGA leaves it): written, still hidden, the sync created", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const r = rig({ ignore: "-:Thumbs.db\r\n-:.*\r\n" });
  const attrib = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "attrib.exe");
  const file = path.join(r.vault, ".megaignore");
  try {
    execFileSync(attrib, ["+h", file], { windowsHide: true });
    const plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    const res = await r.controller.create(plan, IGNORE_OPTIONS);
    assert.equal(res.ok, true, res.message);
    assert.ok(r.ignore()!.includes(BLOCK_BEGIN));
    const out = execFileSync(attrib, [file], { windowsHide: true, encoding: "utf8" });
    assert.ok(out.slice(0, out.toLowerCase().indexOf(file.toLowerCase())).includes("H"), "still hidden");
  } finally {
    r.cleanup();
  }
});

test("create: blockers", async () => {
  const r = rig({ state: { loggedIn: true, email: "a@b.org", folders: { "/RAG": [] }, syncs: [] } });
  try {
    let plan = await r.controller.planCreate("/Missing", IGNORE_OPTIONS);
    assert.equal(plan.ok, false);
    assert.match(plan.blockers.join(), /does not exist on MEGA/);

    r.setState(withSync(r.vault));
    plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    assert.match(plan.blockers.join(), /already syncs this vault/);

    r.setState({ loggedIn: true, email: "a@b.org", folders: { "/RAG": [] }, syncs: [{ id: "Parent1", local: r.dir, remote: "/Top" }] });
    plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    assert.match(plan.blockers.join(), /contains the vault/);

    r.setState({ loggedIn: true, email: "a@b.org", folders: { "/RAG": [] }, syncs: [{ id: "Child1", local: path.join(r.vault, "sub"), remote: "/Sub" }] });
    plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    assert.match(plan.blockers.join(), /inside the vault/);

    r.setState({ loggedIn: true, email: "a@b.org", folders: { "/RAG": [] }, syncs: [{ id: "Other1", local: path.join(r.dir, "Else"), remote: "/RAG/Sub" }] });
    plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    assert.match(plan.blockers.join(), /already in another of MEGAcmd's syncs/);

    r.setState({ loggedIn: false });
    plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    assert.match(plan.blockers.join(), /not signed in/);
    assert.equal(r.calls().filter((c) => c[0] === "sync" && c.length === 3 && !c[1].startsWith("-")).length, 0, "no sync was created");
  } finally {
    r.cleanup();
  }
});

test("create: warnings (desktop app, a non-empty folder, 2.x leftovers)", async () => {
  const r = rig({ processes: ["MEGAcmdServer.exe", "MEGAsync.exe"], state: { loggedIn: true, email: "a@b.org", folders: { "/RAG": ["Notes", "_mega_sync_snapshot.json", ".mega-sync-bin"] } } });
  try {
    const plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    assert.equal(plan.ok, true);
    const w = plan.warnings.join("\n");
    assert.match(w, /MEGA desktop app \(MEGAsync\) is running/);
    assert.match(w, /not empty \(3 items/);
    assert.match(w, /left by MEGA-Route 2\.x/);
    assert.deepEqual(plan.legacyItems, ["_mega_sync_snapshot.json", ".mega-sync-bin"]);
  } finally {
    r.cleanup();
  }
});

test("hostile MEGA folders (from a synced data.json) are refused before MEGAcmd is asked", async () => {
  const r = rig();
  try {
    for (const bad of ['/RAG" -d "X', "/RAG\n/other", "//bin/RAG", "RAG", "/", "/a/../b", "/-d", "/RAG\\x"]) {
      const before = r.calls().filter((c) => c[0] === "ls" || (c[0] === "sync" && c.length === 3)).length;
      const plan = await r.controller.planCreate(bad, IGNORE_OPTIONS);
      assert.equal(plan.ok, false, JSON.stringify(bad));
      const after = r.calls().filter((c) => c[0] === "ls" || (c[0] === "sync" && c.length === 3)).length;
      assert.equal(after, before, `no ls or sync for ${JSON.stringify(bad)}`);
      const res = await r.controller.makeRemoteFolder(bad);
      assert.equal(res.ok, false);
    }
    assert.equal(r.calls().filter((c) => c[0] === "mkdir").length, 0);
  } finally {
    r.cleanup();
  }
});

test("a vault path with shell characters is passed as one argument, and nothing runs it", async () => {
  // Characters a Windows folder name may hold that a shell would act on (> and | cannot be in a folder name).
  const name = "Vault & mkdir pwned.txt ; $(mkdir pwned.txt) %PATH% `x` ^! 'q'";
  const r = rig({ vaultName: name });
  try {
    const plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    assert.equal(plan.ok, true, plan.blockers.join("; "));
    const res = await r.controller.create(plan, IGNORE_OPTIONS);
    assert.equal(res.ok, true, res.message);
    const add = r.calls().find((c) => c[0] === "sync" && c.length === 3)!;
    assert.deepEqual(add, ["sync", r.vault, "/RAG"]);
    assert.equal(add[1].endsWith(name), true);
    for (const d of [r.dir, r.vault, process.cwd()]) assert.equal(fs.existsSync(path.join(d, "pwned.txt")), false);
  } finally {
    r.cleanup();
  }
});

test("a vault path with a quotation mark is refused (MEGAcmd's client would split it)", async () => {
  const r = rig();
  try {
    // A Windows folder cannot hold ", so the controller is given such a path directly.
    (r.controller as unknown as { env: { vaultPath: string } }).env.vaultPath = 'C:\\x\\a" -d "b';
    const plan = await r.controller.planCreate("/RAG", IGNORE_OPTIONS);
    assert.equal(plan.ok, false);
    assert.match(plan.blockers.join(), /quotation mark/);
  } finally {
    r.cleanup();
  }
});

test("mkdir: the exact arguments", async () => {
  const r = rig({ state: { loggedIn: true, email: "a@b.org", folders: {} } });
  try {
    const res = await r.controller.makeRemoteFolder("/Notes/Vault");
    assert.equal(res.ok, true, res.message);
    assert.deepEqual(r.calls().at(-1), ["mkdir", "-p", "/Notes/Vault"]);
  } finally {
    r.cleanup();
  }
});

test("start and stop: version (which starts the server) and quit", async () => {
  const r = rig();
  try {
    await r.controller.startServer();
    assert.deepEqual(r.calls()[0], ["version"]);
    await r.controller.stopServer();
    assert.ok(r.calls().some((c) => c.length === 1 && c[0] === "quit"));
  } finally {
    r.cleanup();
  }
});

test("a call that hangs is killed at its time limit and reported", async () => {
  const r = rig({ state: { loggedIn: true, email: "a@b.org", hang: "whoami" } });
  const old = TIMEOUT.quick;
  TIMEOUT.quick = 1500;
  try {
    const s = await r.controller.refresh(true);
    assert.equal(s.account.signedIn, null);
    assert.match(s.error ?? "", /did not answer within the time limit/);
    assert.equal(shown(s).level, "attention");
  } finally {
    TIMEOUT.quick = old;
    r.cleanup();
  }
});
