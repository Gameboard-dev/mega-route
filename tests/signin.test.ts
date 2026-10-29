// Signing in through the plugin, against the fake MEGAcmd: the relay, every outcome, the two-factor code on MEGAcmd's
// input, redaction everywhere, hostile values refused before anything runs, and which controls are greyed out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rig } from "./helpers.ts";
import type { Rig } from "./helpers.ts";
import { CODE_TRIES, TIMEOUT, classifyLogin } from "../src/core/controller.ts";
import type { SignInResult, SignInUi } from "../src/core/controller.ts";
import { checkEmail, checkPassword, redactMegaCmdLine, redactText } from "../src/core/secrets.ts";
import { NOT_INSTALLED_TIP, START_FIRST_TIP, SIGN_IN_FIRST_TIP, controls, emptyState } from "../src/core/status.ts";

const EMAIL = "someone@example.com";
const PASSWORD = "Correct horse & 'battery' $(staple) %PATH%";

/** A sign-in UI that answers the code questions with `codes` in turn (the last one repeated; null cancels) and records
 *  what it was asked. */
function ui(codes: string | null | (string | null)[] = null) {
  const list = Array.isArray(codes) ? codes : [codes];
  const seen = { asked: 0, done: 0, retries: 0 };
  const u: SignInUi = {
    askCode: async (info) => {
      seen.asked++;
      if (info.retry) seen.retries++;
      return list[Math.min(seen.asked - 1, list.length - 1)];
    },
    done: () => {
      seen.done++;
    },
  };
  return { u, seen };
}

/** Nothing the user typed (password, code, full address) appears in the result, the log, or MEGAcmd's other calls. */
function assertNoSecrets(r: Rig, res: SignInResult, secrets: string[]) {
  const logs = r.logs.map((l) => l.text).join("\n");
  for (const s of secrets) {
    assert.ok(!res.message.includes(s), `the message holds ${JSON.stringify(s)}: ${res.message}`);
    assert.ok(!logs.includes(s), `the log holds ${JSON.stringify(s)}`);
  }
  // The only call that carries the password is the login itself; no call carries the code.
  for (const c of r.calls().filter((c) => c[0] !== "login")) for (const s of secrets) assert.ok(!c.includes(s));
  assert.ok(!r.calls().some((c) => c[0] === "ENV:MEGACMD_DO_NOT_REDACT_LINES"), "MEGACMD_DO_NOT_REDACT_LINES never reaches MEGAcmd");
}

test("sign in: the password is relayed as one argument, the account masked, nothing kept", async () => {
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: PASSWORD } } });
  try {
    const { u, seen } = ui();
    const res = await r.controller.signIn(EMAIL, PASSWORD, u);
    assert.equal(res.ok, true, res.message);
    assert.equal(res.kind, "ok");
    assert.equal(res.message, "MEGAcmd is signed in as s***@e***.com.");
    assert.deepEqual(r.calls().find((c) => c[0] === "login"), ["login", EMAIL, PASSWORD]);
    assert.equal(seen.asked, 0);
    assert.equal(seen.done, 1);
    assert.equal(r.controller.state.account.signedIn, true);
    assert.equal(r.controller.state.account.masked, "s***@e***.com");
    const after = r.calls().slice(r.calls().findIndex((c) => c[0] === "login") + 1).map((c) => c[0]);
    assert.ok(!after.includes("whoami") && !after.includes("version"), `login's exit code is the check: ${after.join(", ")}`);
    assertNoSecrets(r, res, [PASSWORD, EMAIL]);
  } finally {
    r.cleanup();
  }
});

test("two-factor: the code is asked only when MEGAcmd asks, and given on MEGAcmd's input, never as an argument", async () => {
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: "pw-1", mfa: "482913" } } });
  try {
    const { u, seen } = ui("482 913");
    const res = await r.controller.signIn(EMAIL, "pw-1", u);
    assert.equal(res.ok, true, res.message);
    assert.equal(seen.asked, 1);
    const login = r.calls().find((c) => c[0] === "login")!;
    assert.deepEqual(login, ["login", EMAIL, "pw-1"]);
    assert.ok(!r.calls().flat().some((a) => a.includes("482913") || a.startsWith("--auth-code")));
    assertNoSecrets(r, res, ["pw-1", "482913", EMAIL]);
  } finally {
    r.cleanup();
  }
});

test("one-time code typed before Sign in, two-factor on: sent when MEGAcmd asks, never asked again, never an argument", async () => {
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: "pw-1", mfa: "482913" } } });
  try {
    const { u, seen } = ui();
    const res = await r.controller.signIn(EMAIL, "pw-1", { ...u, code: " 482 913 " });
    assert.equal(res.ok, true, res.message);
    assert.equal(seen.asked, 0, "the field was not asked again");
    assert.deepEqual(r.calls().filter((c) => c[0] === "login"), [["login", EMAIL, "pw-1"]]);
    assert.ok(!r.calls().flat().some((a) => a.includes("482913")));
    assertNoSecrets(r, res, ["pw-1", "482913", EMAIL]);
  } finally {
    r.cleanup();
  }
});

test("one-time code typed, but two-factor off: signed in normally, the code unused, nothing alarming", async () => {
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: "pw-1" } } });
  try {
    const { u, seen } = ui();
    const res = await r.controller.signIn(EMAIL, "pw-1", { ...u, code: "123456" });
    assert.equal(res.ok, true);
    assert.equal(res.message, "MEGAcmd is signed in as s***@e***.com.");
    assert.equal(seen.asked, 0);
    assert.ok(!r.logs.some((l) => l.level !== "debug" && l.level !== "info"), "no warning");
    assertNoSecrets(r, res, ["pw-1", "123456", EMAIL]);
  } finally {
    r.cleanup();
  }
});

test("one-time code typed wrong: MEGAcmd is asked nothing; the field asks for six digits", async () => {
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: "pw-1", mfa: "482913" } } });
  try {
    const res = await r.controller.signIn(EMAIL, "pw-1", { ...ui().u, code: "12ab" });
    assert.equal(res.kind, "refused");
    assert.match(res.message, /six digits/);
    assert.deepEqual(r.calls(), []);
  } finally {
    r.cleanup();
  }
});

test("one-time code typed before Sign in but wrong: the same field asks for the next one, password kept", async () => {
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: "pw-1", mfa: "482913" } } });
  try {
    const { u, seen } = ui("482913");
    const res = await r.controller.signIn(EMAIL, "pw-1", { ...u, code: "111111" });
    assert.equal(res.ok, true, res.message);
    assert.equal(seen.asked, 1);
    assert.equal(seen.retries, 1);
    assert.equal(r.calls().filter((c) => c[0] === "login").length, 2);
    assertNoSecrets(r, res, ["pw-1", "111111", "482913"]);
  } finally {
    r.cleanup();
  }
});

test("two-factor: a wrong (or expired) code, then the right one: retried without the password typed again", async () => {
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: "pw-1", mfa: "482913" } } });
  try {
    const { u, seen } = ui(["111111", "482913"]);
    const res = await r.controller.signIn(EMAIL, "pw-1", u);
    assert.equal(res.ok, true, res.message);
    assert.equal(seen.asked, 2);
    assert.equal(seen.retries, 1, "the second question says the first code was not accepted");
    assert.equal(r.calls().filter((c) => c[0] === "login").length, 2, "MEGAcmd's login is run again with the kept password");
    assertNoSecrets(r, res, ["pw-1", "111111", "482913"]);
  } finally {
    r.cleanup();
  }
});

test("two-factor: wrong codes stop after the limit; a cancelled code stops at once", async () => {
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: "pw-1", mfa: "482913" } } });
  try {
    const wrong = ui("111111");
    let res = await r.controller.signIn(EMAIL, "pw-1", wrong.u);
    assert.equal(res.ok, false);
    assert.equal(res.kind, "wrong-code");
    assert.equal(wrong.seen.asked, CODE_TRIES);
    assert.equal(r.calls().filter((c) => c[0] === "login").length, CODE_TRIES, "no loop beyond the limit");
    assert.match(res.message, /not accepted 3 times/);
    assertNoSecrets(r, res, ["pw-1", "111111"]);
    const second = ui(["111111", null]);
    res = await r.controller.signIn(EMAIL, "pw-1", second.u);
    assert.equal(res.kind, "code-cancelled", "cancelling the retry stops");
    res = await r.controller.signIn(EMAIL, "pw-1", ui(null).u);
    assert.equal(res.kind, "code-cancelled");
    res = await r.controller.signIn(EMAIL, "pw-1", ui("12ab").u);
    assert.equal(res.kind, "code-cancelled", "a code that is not six digits is not sent");
    assert.equal(r.controller.state.account.signedIn, false);
  } finally {
    r.cleanup();
  }
});

test("verification MEGA asks for outside MEGAcmd: a suspended account (email or phone), too many attempts", async () => {
  const reason = "Your account has been temporarily suspended for your safety. Please verify your email and follow its steps to unlock your account.";
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: "pw", blocked: reason } } });
  try {
    let res = await r.controller.signIn(EMAIL, "pw", ui().u);
    assert.equal(res.kind, "blocked");
    assert.match(res.message, /verify your email/);
    assert.match(res.message, /sign in again here/);
    assertNoSecrets(r, res, ["pw", EMAIL]);
    r.setState({ loggedIn: false, folders: {}, account: { email: EMAIL, password: "pw", tooMany: true } });
    res = await r.controller.signIn(EMAIL, "pw", ui().u);
    assert.equal(res.kind, "too-many");
    assert.equal(r.calls().filter((c) => c[0] === "login").length, 2, "one login each, no retry");
  } finally {
    r.cleanup();
  }
});

test("MEGAcmd's login outcomes by exit code and message", () => {
  const base = { stdout: "", stderr: "", timedOut: false, ms: 1 };
  const k = (code: number, text = "", asked = false) => classifyLogin({ ...base, code, stderr: text }, text, asked);
  assert.equal(k(0), "ok");
  assert.equal(k(54, "Already logged in. Please log out first."), "already");
  assert.equal(k(9, "Login failed: invalid email or password"), "wrong-password");
  assert.equal(k(5, "Login failed: incorrect authentication", true), "wrong-code");
  assert.equal(k(13, "Login failed: unconfirmed account. Please confirm your account"), "unconfirmed");
  assert.equal(k(16, "Failed to Login: Account blocked.Reason: Please verify your phone number"), "blocked");
  assert.equal(k(6), "too-many");
  assert.equal(k(26), "code-cancelled");
  assert.equal(k(3, "Login took too long, it may have failed. No further actions performed"), "timeout");
  assert.equal(k(59, "something else"), "failed");
});

test("the other outcomes: wrong password, already signed in, unconfirmed account, time-out", async () => {
  const r = rig({ state: { loggedIn: false, folders: {}, account: { email: EMAIL, password: "right" } } });
  try {
    let res = await r.controller.signIn(EMAIL, "wrong-pass", ui().u);
    assert.equal(res.kind, "wrong-password");
    assert.match(res.message, /did not accept that email and password/);
    assertNoSecrets(r, res, ["wrong-pass", EMAIL]);

    r.setState({ loggedIn: true, email: EMAIL, folders: {}, account: { email: EMAIL, password: "right" } });
    res = await r.controller.signIn(EMAIL, "right", ui().u);
    assert.equal(res.kind, "already");
    assert.equal(res.ok, true);

    r.setState({ loggedIn: false, folders: {}, account: { email: EMAIL, password: "right", unconfirmed: true } });
    res = await r.controller.signIn(EMAIL, "right", ui().u);
    assert.equal(res.kind, "unconfirmed");
    assert.match(res.message, /not confirmed/);

    r.setState({ loggedIn: false, folders: {}, account: { email: EMAIL, password: "right", slow: 60_000 } });
    const old = TIMEOUT.login;
    TIMEOUT.login = 1500;
    try {
      res = await r.controller.signIn(EMAIL, "right", ui().u);
    } finally {
      TIMEOUT.login = old;
    }
    assert.equal(res.kind, "timeout");
    assert.match(res.message, /did not finish signing in/);
    assertNoSecrets(r, res, ["right", EMAIL]);
  } finally {
    r.cleanup();
  }
});

test("MEGAcmd's server stopped: nothing is run (signing in would start it); the user is told to start it", async () => {
  const r = rig({ processes: [], state: { loggedIn: false, account: { email: EMAIL, password: "pw" } } });
  try {
    const res = await r.controller.signIn(EMAIL, "pw", ui().u);
    assert.equal(res.kind, "server-stopped");
    assert.match(res.message, /Start MEGAcmd first/);
    assert.deepEqual(r.calls(), []);
  } finally {
    r.cleanup();
  }
});

test("MEGAcmd not installed: nothing is run, the message says where to get it", async () => {
  const r = rig({ noClient: true });
  try {
    const res = await r.controller.signIn(EMAIL, "pw", ui().u);
    assert.equal(res.kind, "not-found");
    assert.match(res.message, /mega\.io\/cmd/);
    assert.deepEqual(r.calls(), []);
  } finally {
    r.cleanup();
  }
});

test("hostile emails and passwords are refused before anything runs, and never repeated", async () => {
  const r = rig({ state: { loggedIn: false, account: { email: EMAIL, password: "pw" } } });
  try {
    const emails = ['"a"@b.com', "-o@b.com", "a@b.com\n--auth-code=1", "a b@c.com", "'x@y.com", "", "a@b", "a\\b@c.com", "x".repeat(300) + "@b.com", "a@b.com" + String.fromCharCode(0x2028)];
    for (const e of emails) {
      const res = await r.controller.signIn(e, "pw", ui().u);
      assert.equal(res.kind, "refused", JSON.stringify(e));
      if (e.length > 3) assert.ok(!res.message.includes(e), "the email is not repeated");
    }
    const passwords = ['pa"ss', "-o", "-pw", "'abc", "a\nb", "a\tb", "", "x".repeat(1100)];
    for (const pw of passwords) {
      const res = await r.controller.signIn(EMAIL, pw, ui().u);
      assert.equal(res.kind, "refused", JSON.stringify(pw));
      if (pw.length > 1) assert.ok(!res.message.includes(pw), "the password is not repeated");
    }
    assert.deepEqual(r.calls(), [], "MEGAcmd was never run");
    assert.equal(checkPassword("'with a space").ok, true, "a leading ' is fine when the password holds a space (MEGAcmd's client quotes it)");
    assert.equal(checkEmail("first.last+tag@sub.example.co.uk").ok, true);
  } finally {
    r.cleanup();
  }
});

test("redaction of text and of MEGAcmd's log lines", () => {
  assert.equal(redactText("failed for someone@example.com with hunter22 and hunter2", ["hunter2", "hunter22"]), "failed for s***@e***.com with [redacted] and [redacted]");
  const lines: [string, string][] = [
    ["petition registered: login <REDACTED>", "petition registered: login <REDACTED>"],
    ["starting processing: <login someone@example.com hunter2>", "starting processing: <login [redacted]"],
    ["Processing Xlogin someone@example.com  hunter2 in thread: 7", "Processing Xlogin [redacted]"],
    [" Using confirmation pin: 482913", " Using confirmation pin: [redacted]"],
    ["executing: login --auth-code=482913 a@b.org pw", "executing: login --auth-code=[redacted] a***@b***.org pw"],
    ["actUponLogin login email: someone@example.com", "actUponLogin login email: s***@e***.com"],
    ["Login correct ... someone@example.com", "Login correct ... s***@e***.com"],
    ["[err: ] Login failed: invalid email or password", "[err: ] Login failed: invalid email or password"],
    ["passwd oldpw newpw", "passwd [redacted]"],
    ["Sync - sending file C:\\vault\\note.md", "Sync - sending file C:\\vault\\note.md"],
  ];
  for (const [inp, out] of lines) assert.equal(redactMegaCmdLine(inp), out, inp);
});

test("controls: greyed out without MEGAcmd, with a tooltip to install it; and while its server is stopped", () => {
  const s = emptyState();
  let c = controls(s);
  for (const k of ["start", "stop", "signIn", "create", "change"] as const) {
    assert.equal(c[k].enabled, false, k);
    assert.equal(c[k].tip, NOT_INSTALLED_TIP);
  }
  assert.match(NOT_INSTALLED_TIP, /https:\/\/mega\.io\/cmd/);
  assert.match(NOT_INSTALLED_TIP, /restart Obsidian or set MEGAcmd's folder/);

  s.client = { path: "C:\\x\\MegaClient.exe", found: true };
  s.server = "stopped";
  c = controls(s);
  assert.equal(c.start.enabled, true);
  assert.equal(c.signIn.enabled, false);
  assert.equal(c.signIn.tip, START_FIRST_TIP);
  assert.equal(c.create.tip, START_FIRST_TIP);

  s.server = "running";
  s.account = { signedIn: false };
  c = controls(s);
  assert.equal(c.signIn.enabled, true);
  assert.equal(c.create.enabled, false);
  assert.equal(c.create.tip, SIGN_IN_FIRST_TIP);

  s.account = { signedIn: true, masked: "s***@e***.com" };
  c = controls(s);
  assert.equal(c.signIn.enabled, false);
  assert.equal(c.create.enabled, true);
  assert.equal(c.change.enabled, false);
});
