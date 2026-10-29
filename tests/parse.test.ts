// Reading MEGAcmd's answers (formats of MEGAcmd 2.x).

import { test } from "node:test";
import assert from "node:assert/strict";
import { COL_SEP, maskEmail, outcome, parseLs, parseProcessNames, parseSyncIssues, parseSyncList, parseTransferSummary, parseVersion, parseWhoami } from "../src/core/parse.ts";
import { sizeToBytes } from "../src/core/parse.ts";

const S = COL_SEP;

test("version and whoami", () => {
  assert.equal(parseVersion("MEGAcmd version: 2.1.1.0: code 2010100\n"), "2.1.1.0");
  assert.equal(parseVersion("something else"), null);
  assert.equal(parseWhoami("Account e-mail: someone@example.com\n"), "someone@example.com");
  assert.equal(parseWhoami("[err: ] Not logged in"), null);
});

test("addresses are masked", () => {
  assert.equal(maskEmail("someone@example.com"), "s***@e***.com");
  assert.equal(maskEmail("a@b.co.uk"), "a***@b***.uk");
  assert.equal(maskEmail("broken"), "***");
});

test("the sync list, with the separator, every column", () => {
  const out = [
    `ID${S}LOCALPATH${S}REMOTEPATH${S}RUN_STATE${S}STATUS${S}ERROR${S}SIZE${S}FILES${S}DIRS`,
    `Ab12Cd34${S}\\\\?\\C:\\Users\\me\\Documents\\MEGA\\RAG${S}/RAG${S}Running${S}Synced${S}NO${S}285.91 MB${S}7710${S}1003`,
    `Xy98Zw76${S}\\\\?\\C:\\Data\\Photos${S}/Photos backup${S}Disabled${S}NONE${S}NO${S}0.00  B${S}0${S}0`,
    "",
    'You have sync issues. Use the "sync-issues" command to display them.',
  ].join("\r\n");
  const { rows, problems } = parseSyncList(out);
  assert.deepEqual(problems, []);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: "Ab12Cd34", localPath: "\\\\?\\C:\\Users\\me\\Documents\\MEGA\\RAG", remotePath: "/RAG", runState: "Running", status: "Synced", error: "NO", size: "285.91 MB", files: 7710, dirs: 1003 });
  assert.equal(rows[1].remotePath, "/Photos backup");
  assert.equal(rows[1].runState, "Disabled");
});

test("the sync list: no syncs, and a malformed row is reported, not guessed", () => {
  assert.deepEqual(parseSyncList(`ID${S}LOCALPATH${S}REMOTEPATH\n`).rows, []);
  assert.deepEqual(parseSyncList("").rows, []);
  const r = parseSyncList(`ID${S}LOCALPATH${S}REMOTEPATH${S}RUN_STATE\nX${S}C:\\a${S}/b\n`);
  assert.equal(r.rows.length, 0);
  assert.equal(r.problems.length, 1);
});

test("the transfer summary", () => {
  const out = [
    "   NUM DOWNLOADS  DOWNLOADED       TOTAL    %        NUM UPLOADS    UPLOADED       TOTAL    %   ",
    "               2     1.00 MB     4.00 MB  25.00%                 10     3.00 MB     4.00 MB  75.00%",
  ].join("\n");
  const t = parseTransferSummary(out)!;
  assert.equal(t.downloads, 2);
  assert.equal(t.uploads, 10);
  assert.equal(t.uploadTotal, "4.00 MB");
  assert.equal(t.uploadPercent, 75);
  const idle = parseTransferSummary("               0     0.00  B     0.00  B   0.00%                  0     0.00  B     0.00  B   0.00%")!;
  assert.equal(idle.uploads, 0);
  assert.equal(parseTransferSummary("nothing here"), null);
});

test("sizes", () => {
  assert.equal(sizeToBytes("0.00  B"), 0);
  assert.equal(sizeToBytes("2.00 KB"), 2048);
  assert.equal(sizeToBytes("1.50 GB"), 1.5 * 1024 ** 3);
  assert.equal(sizeToBytes("lots"), null);
});

test("sync issues", () => {
  const out = `ISSUE_ID${S}PARENT_SYNC${S}REASON\nI1${S}Ab12Cd34${S}Local and remote changed since last synced\n`;
  assert.deepEqual(parseSyncIssues(out), [{ id: "I1", sync: "Ab12Cd34", reason: "Local and remote changed since last synced" }]);
  assert.deepEqual(parseSyncIssues("There are no sync issues"), []);
});

test("ls leaves out a heading line", () => {
  assert.deepEqual(parseLs("/RAG:\nNotes\n_mega_sync_snapshot.json\n\n", "/RAG"), ["Notes", "_mega_sync_snapshot.json"]);
  assert.deepEqual(parseLs("a.md\r\nb c.md\r\n", "/RAG"), ["a.md", "b c.md"]);
});

test("process names, Windows and POSIX", () => {
  const win = '"System Idle Process","0","Services","0","8 K"\r\n"MEGAcmdServer.exe","4242","Console","1","40,000 K"\r\n';
  assert.deepEqual(parseProcessNames(win, true), ["System Idle Process", "MEGAcmdServer.exe"]);
  assert.deepEqual(parseProcessNames("INFO: No tasks are running which match the specified criteria.\r\n", true), []);
  assert.deepEqual(parseProcessNames("/usr/bin/mega-cmd-server\nzsh\n", false), ["mega-cmd-server", "zsh"]);
});

test("outcomes: codes, time-outs, a program that does not start", () => {
  const base = { stdout: "", stderr: "", timedOut: false, ms: 10 };
  assert.equal(outcome({ ...base, code: 0 }, "x").kind, "ok");
  assert.equal(outcome({ ...base, code: 57, stderr: "[err: ] Not logged in" }, "x").kind, "not-logged-in");
  assert.equal(outcome({ ...base, code: 53, stderr: "Couldn't find /X" }, "x").kind, "not-found");
  assert.equal(outcome({ ...base, code: 64 }, "x").kind, "exists");
  assert.equal(outcome({ ...base, code: -1, timedOut: true, ms: 15000 }, "x").kind, "timeout");
  const n = outcome({ ...base, code: -1, spawnError: "ENOENT" }, "Listing");
  assert.equal(n.kind, "not-started");
  assert.match((n as { message: string }).message, /Listing: MEGAcmd could not be started \(ENOENT\)/);
  const f = outcome({ ...base, code: 59, stderr: "boom" }, "Doing");
  assert.equal(f.kind, "failed");
  assert.match((f as { message: string }).message, /code 59: boom/);
});
