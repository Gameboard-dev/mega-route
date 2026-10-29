# Building and testing

[← README](../README.md)

- [Build](#build)
- [Tests](#tests)
- [The code](#the-code)
- [Releasing](#releasing)

## Build

MEGA-Route is a small TypeScript plugin, built with [esbuild](https://esbuild.github.io/) into one `main.js`. (The
author's other plugins are Rust compiled to WebAssembly; this one only runs a program and draws a few settings, which
TypeScript does with less machinery.)

Needs Node.js 22.6 or later (the tests run TypeScript directly, which Node does from 22.6 with type stripping; 24 is
used here).

```sh
npm ci              # esbuild, TypeScript, Obsidian's type definitions, Node's types
npm run typecheck   # tsc --noEmit: the types, strictly
npm run build       # esbuild → main.js
npm test            # the tests (run the build first: two tests load main.js)
```

`npm run dev` rebuilds on every change. `main.js` is committed, so the repository's files can be copied into a vault as
they are.

## Tests

`npm test` runs `node --test "tests/*.test.ts"`, with no network and nothing installed: MEGAcmd is replaced by a fake.

**The fake MEGAcmd** (`tests/fake/megaclient.cjs`) answers the commands the plugin uses (`version`, `whoami`, `sync` to
list, add, pause, resume and remove, `ls`, `mkdir`, `transfers --summary`, `sync-issues`, `quit`) in MEGAcmd 2.x's
formats and with its exit codes (51 wrong arguments, 53 not found, 57 not signed in, 64 exists), from a JSON state file,
and records each call's argument array. `tests/fake/processes.cjs` stands in for `tasklist` and `ps`. The controller is
given the fake as its client, run by Node with an argument array, exactly as the plugin runs MEGAcmd.

| File | What it checks |
|---|---|
| `controller.test.ts` | MEGAcmd not installed (nothing run); server stopped (MEGAcmd asked nothing); process list unreadable; not signed in; signed in with no sync (address masked, never logged); each sync state (synced, paused, suspended, loading, pending, processing, error); transfers counted; sync issues; the vault's sync found whatever the case or `\\?\` prefix; the exact argument arrays of list, pause, resume, remove, mkdir, create, start and stop; an id starting with `-` replaced by the folder; create: `.megaignore` written before `sync`, the user's lines kept; each blocker; each warning; hostile MEGA folders refused before MEGAcmd is asked; a vault path with shell characters (`&`, `;`, `$( )`, `%PATH%`, backquotes, `^!`) passed as one argument, and nothing executed; a quotation mark refused; a hanging call killed at its time limit. |
| `parse.test.ts` | Reading `version`, `whoami`, the sync list, the transfer summary, sync issues, `ls`, the process list; masking addresses; exit codes, time-outs and programs that do not start. |
| `paths.test.ts` | The checks on MEGA folders (each hostile or wrong form), local folders, sync ids, comparisons; where MEGAcmd is on each system; the check on a client path (not MEGAcmd, inside the vault, relative, missing). |
| `megaignore.test.ts` | Patterns as MEGA rules with exactly their meaning (`-pr:` regular expressions for wildcards, checked by matching paths: a `*` stays in its folder, `**` crosses folders); the user's LaTeX build-output list written with no problem and no note; a `*` in a middle folder; `.obsidian` refused; patterns refused; the block's order (fixed rules last); a fresh file; an existing file kept byte for byte (CRLF, a byte-order mark), the block replaced, unchanged rules leaving the file unchanged. |
| `settings.test.ts` | Moving 2.x settings (what is carried over, what is set aside, the sign-in data untouched); loading version 3 twice; defaults; per-device settings. |
| `fsio.test.ts` | On Windows, a real hidden `.megaignore` (made hidden with `attrib` in the test's setup only): Node's `writeFile` fails with EPERM (the reported bug), the plugin's in-place write succeeds and the file stays hidden; a shorter text truncates; a missing file is created; bytes read back differently are reported; failure messages say what to do. |
| `progress.test.ts` | The progress: a first upload whose queue grows and shrinks (the percentage only rises, 0% to 99%, then 100% when MEGAcmd reports the sync in sync), the status bar and tooltip agreeing, a few edits shown as files to upload, downloads, no count yet; the `.megaignore` evaluation (last rule wins, `N` at the top only, path and regular-expression rules, MEGA's glob); the count of covered files in a real folder with the exclusions, listed as Obsidian's adapter lists it. |
| `signout.test.ts` | Signing out: the order pause, cancel, no live transfer, logout, whoami (never `--keep-session`), each step reported; the paused sync's transfers left listed by the cancel (no waiting: one look); a sign-in and a resume refused at once while it runs; no sync configured; a transfer still queued (stops at step 3, no logout); logout failing (stops at step 4); server stopped (nothing run). |
| `activity.test.ts` | A large file uploading while the file count stands still (shown moving: rate, file, its percentage); nothing moving for 2 minutes (said, with MEGAcmd's reason: RETRYING, or scanning with nothing queued); the transfer list; a sign-out cut short found from MEGAcmd's state at the next start; the plugin's log file (appended, cut over at its limit, never throwing), also through Obsidian's adapter. |
| `log.test.ts` | The bounded log; following a log file: its last part first, whole lines only, a rotated file, a burst beyond the limit. |
| `signin.test.ts` | Signing in (the fake MEGAcmd answers with MEGAcmd's own question, messages and exit codes): a one-time code typed before Sign in (sent when MEGAcmd asks, unused when two-factor is off, refused if not six digits, asked again if wrong); a wrong or expired code retried without the password typed again, at most three codes; a suspended account (verify by email or phone) and too many attempts; each exit code classified; the password relayed as one argument of `login` (with shell characters in it), the result and the log free of the password, the code and the full address; two-factor: the code asked only when MEGAcmd asks, written to MEGAcmd's input and never an argument, a wrong code, a cancelled one, one that is not six digits; wrong password, already signed in, unconfirmed account, time-out; nothing run while the server is stopped or MEGAcmd is missing; hostile emails and passwords (quotes, leading `-`, `-o`, line breaks, tabs, U+2028, too long) refused before anything runs and never repeated; redaction of MEGAcmd's log lines; which controls are greyed out, with which tooltip. |
| `noshell.test.ts` | No shell, no `exec`/`execSync`, no `eval`, no detached processes, no terminal or MEGAcmd shell in the sources or in `main.js`; processes started only in `src/core/runner.ts`; no `localStorage`/`sessionStorage`, no clipboard read, Node's `fs` loaded only in `src/node.ts`, no `!important` or `:has` in `styles.css`; the runner's options (`shell: false`, hidden, time limit, output cap, arguments as an array, `MEGACMD_DO_NOT_REDACT_LINES` taken out of the environment). |
| `plugin.test.ts` | The built `main.js` with a stand-in for Obsidian: it loads; 2.x settings are moved once (backup written, sign-in data kept); nothing written to `.megaignore` at load; with MEGAcmd missing, the status bar says so; a second load saves nothing. |

Not covered by the tests: the settings tab's and the dialogs' drawing (only seen in Obsidian), and a real MEGAcmd.

## The code

```
src/
  main.ts              the plugin: settings, status bar, ribbon and menu, commands, status checks, dialogs' flow
  node.ts              Node's modules, loaded only in the desktop app
  core/                no Obsidian code here (the tests use it directly)
    runner.ts          the only place a process is started: argument array, no shell, hidden, time limit, output cap
    secrets.ts         checks on the sign-in email, password and code; redaction of messages and MEGAcmd log lines
    controller.ts      every request to MEGAcmd: checks, create, pause, resume, remove, start, stop, status
    parse.ts           reading MEGAcmd's answers; MEGAcmd's exit codes
    paths.ts           checks on the MEGA folder, the vault's folder and sync ids; comparing paths
    locate.ts          where MEGAcmd is on each system; the check on a client path
    megaignore.ts      exclusion patterns as MEGA rules; the plugin's block in .megaignore
    status.ts          the state, and what the status bar says about it
    settings.ts        the settings, per-device settings, moving 2.x settings
    log.ts             the in-memory log, and following MEGAcmd's log file
    logfile.ts         the plugin's own log file (written through Obsidian's adapter, vaultfs.ts)
    vaultfs.ts         the vault through Obsidian's adapter: listing, reading .megaignore, the copy, the log file
    fsio.ts            the one write with Node's fs: .megaignore in place (MEGA marks it hidden)
    coverage.ts        .megaignore as MEGA reads it; the count of the files the sync covers
    progress.ts        the progress of a sync run, the transfer rate, "no progress"
  ui/
    settingsTab.ts     the settings tab
    logPane.ts         the live log pane
    modals.ts          the confirmation dialogs
tests/                 the tests, the fake MEGAcmd and the fake process list
```

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`) from a pushed tag `x.y.z` (no `v`):

1. `npm version x.y.z --no-git-tag-version` (sets `package.json`, and through `version-bump.mjs` `manifest.json` and
   `versions.json`), and write `.github/release-notes/x.y.z.md`.
2. `npm run build && npm test`, then `node scripts/release-check.mjs`: the versions agree, the description fits
   Obsidian's rules, and `main.js`, `manifest.json` and `styles.css` hold no user folder path, email address, inline
   source map, `eval` or shell use. Words of your own that must never appear (your name, folders, account) go in the
   git-ignored file `.release-scan.local`, one per line.
3. Commit (with the built `main.js`), push, then `git tag x.y.z && git push origin x.y.z`.

The workflow then types, builds and tests again, checks that the committed `main.js` equals a fresh build, runs the
release check, attests the three files' build provenance and publishes the release with exactly those three files
(`gh attestation verify main.js --repo Gameboard-dev/mega-route` checks a downloaded file).
