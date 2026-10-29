// Signing out of MEGA from the plugin, against the fake MEGAcmd: the order of the steps, the calls saved, and each
// failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rig } from "./helpers.ts";
import { SIGN_OUT_QUEUE_MS, setSignOutQueueMs } from "../src/core/controller.ts";

const busy = { downloads: 0, downloaded: "0.00  B", downloadTotal: "0.00  B", downloadPct: "0.00", uploads: 12, uploaded: "1.00 MB", uploadTotal: "9.00 MB", uploadPct: "11.11" };

function signedInWithSync(vault: string, extra: Record<string, unknown> = {}) {
  return { loggedIn: true, email: "someone@example.com", folders: { "/RAG": [] }, syncs: [{ id: "Ab12Cd34", local: vault, remote: "/RAG", runState: "Running", status: "Syncing" }], transfers: busy, ...extra };
}

test("sign out, usual case: pause, one look at the other transfers, logout; nothing else asked", async () => {
  const r = rig();
  try {
    r.setState(signedInWithSync(r.vault, { transferRows: [{ sync: true, state: "ACTIVE" }] }));
    await r.controller.refresh(true);
    const before = r.calls().length;
    const steps: string[] = [];
    const res = await r.controller.signOut((n, of, text) => steps.push(`${n}/${of} ${text}`));
    assert.equal(res.ok, true, res.message);
    assert.deepEqual(steps, ["1/3 pausing the sync", "2/3 stopping other transfers", "3/3 signing MEGAcmd out"]);
    const order = r.calls().slice(before).map((c) => c.join(" "));
    assert.equal(order.length, 3, `three calls to MEGAcmd: ${order.join(" | ")}`);
    assert.equal(order[0], "sync -p Ab12Cd34");
    assert.ok(order[1].startsWith("transfers --limit=1000"));
    assert.equal(order[2], "logout");
    assert.ok(!order.some((s) => s.includes("--keep-session")), "never --keep-session (it keeps the session and prints its id)");
    assert.equal(r.state().loggedIn, false);
    assert.equal(r.controller.state.account.signedIn, false);
    assert.equal(r.controller.state.mine, null);
    assert.match(res.message, /files on both sides are untouched/);
    assert.ok(r.logs.some((l) => /Took \d+ ms \(probe and steps 1: \d+ ms, 2: \d+ ms, 3: \d+ ms\)/.test(l.text)), "each step's time is logged");
    assert.ok(!r.logs.some((l) => l.text.includes("someone@example.com")), "no full address in the log");
  } finally {
    r.cleanup();
  }
});

test("other transfers live: cancelled (transfers -c -a), then checked; the paused sync's own are not waited for", async () => {
  const r = rig();
  try {
    r.setState(signedInWithSync(r.vault, { transferRows: [{ sync: false, state: "ACTIVE" }, { sync: true, state: "PAUSED" }] }));
    await r.controller.refresh(true);
    const before = r.calls().length;
    const t0 = Date.now();
    const res = await r.controller.signOut();
    assert.equal(res.ok, true, res.message);
    const order = r.calls().slice(before).map((c) => c.slice(0, 2).join(" "));
    assert.deepEqual(order, ["sync -p", "transfers --limit=1000", "transfers -c", "transfers --limit=1000", "logout"]);
    assert.ok(Date.now() - t0 < SIGN_OUT_QUEUE_MS);
  } finally {
    r.cleanup();
  }
});

test("while signing out, a sign-in (or any other action) is refused at once, not queued", async () => {
  const r = rig();
  try {
    r.setState(signedInWithSync(r.vault));
    await r.controller.refresh(true);
    let during: { kind: string; message: string } | null = null;
    let duringCreate: { ok: boolean; message: string } | null = null;
    const res = await r.controller.signOut((n) => {
      if (n === 2 && !during) {
        void r.controller.signIn("someone@example.com", "pw", { askCode: async () => null, done: () => undefined }).then((x) => (during = x));
        void r.controller.change("resume").then((x) => (duringCreate = x));
      }
    });
    await new Promise((res2) => setTimeout(res2, 50));
    assert.equal(res.ok, true, res.message);
    assert.equal(during!.kind, "busy");
    assert.match(during!.message, /Signing out is in progress/);
    assert.equal(duringCreate!.ok, false);
    assert.ok(!r.calls().some((c) => c[0] === "login"), "no login was run");
    assert.equal(r.controller.state.operation, null, "the lock is released at the end");
  } finally {
    r.cleanup();
  }
});

test("sign out with no sync configured: no pause, the rest as usual", async () => {
  const r = rig({ state: { loggedIn: true, email: "a@b.org", folders: {} } });
  try {
    await r.controller.refresh(true);
    const res = await r.controller.signOut();
    assert.equal(res.ok, true, res.message);
    assert.ok(!r.calls().some((c) => c[0] === "sync" && c[1] === "-p"));
    assert.ok(r.calls().some((c) => c[0] === "logout"));
  } finally {
    r.cleanup();
  }
});

test("another transfer still live after cancelling: stops at step 2, still signed in, no logout", async () => {
  const r = rig();
  const old = SIGN_OUT_QUEUE_MS;
  setSignOutQueueMs(1200);
  try {
    r.setState(signedInWithSync(r.vault, { stuckTransfers: true, transferRows: [{ sync: false, state: "ACTIVE" }, { sync: false, state: "RETRYING" }] }));
    await r.controller.refresh(true);
    const res = await r.controller.signOut();
    assert.equal(res.ok, false);
    assert.equal(res.step, 2);
    assert.match(res.message, /2 transfer\(s\) are still active or retrying/);
    assert.match(res.message, /still signed in/);
    assert.ok(!r.calls().some((c) => c[0] === "logout"), "logout is not run");
    assert.equal(r.state().loggedIn, true);
  } finally {
    setSignOutQueueMs(old);
    r.cleanup();
  }
});

test("logout fails: stops at step 3 and says the sync is paused", async () => {
  const r = rig();
  try {
    r.setState(signedInWithSync(r.vault, { logoutFails: true }));
    await r.controller.refresh(true);
    const res = await r.controller.signOut();
    assert.equal(res.ok, false);
    assert.equal(res.step, 3);
    assert.match(res.message, /step 3 of 3 \(signing MEGAcmd out\)/);
    assert.match(res.message, /State: the sync is paused; MEGAcmd may still be signed in/);
    assert.equal(r.state().syncs![0].runState, "Disabled");
  } finally {
    r.cleanup();
  }
});

test("server stopped: nothing is run", async () => {
  const r = rig({ processes: [] });
  try {
    const res = await r.controller.signOut();
    assert.equal(res.ok, false);
    assert.deepEqual(r.calls(), []);
  } finally {
    r.cleanup();
  }
});
