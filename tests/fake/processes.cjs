#!/usr/bin/env node
// A stand-in for `tasklist /FO CSV /NH` (Windows) and `ps -A -o comm=`, for the tests: prints the process names in
// FAKE_PROCESSES (comma-separated) in the format of the system named by FAKE_PROCESSES_OS ("windows" or "posix").
// FAKE_PROCESSES_FAIL=1 makes it fail as an unreadable process list would.
"use strict";
if (process.env.FAKE_PROCESSES_FAIL === "1") {
  process.stderr.write("ERROR: Access denied\n");
  process.exit(1);
}
const names = (process.env.FAKE_PROCESSES || "").split(",").filter(Boolean);
const windows = (process.env.FAKE_PROCESSES_OS || "windows") === "windows";
const all = windows ? ["System Idle Process", "explorer.exe", ...names] : ["/sbin/launchd", "/usr/bin/zsh", ...names];
for (const [i, n] of all.entries()) {
  process.stdout.write(windows ? `"${n}","${1000 + i}","Console","1","10,000 K"\n` : `${n}\n`);
}
