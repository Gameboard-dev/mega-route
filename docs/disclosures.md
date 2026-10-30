# Disclosures and compliance

[← README](../README.md)

MEGA-Route is written to meet Obsidian's
[Developer policies](https://docs.obsidian.md/community-directory/developer-policies) and
[Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines). This page goes through what those
policies ask a plugin to disclose, and what they forbid, and says plainly what MEGA-Route does about each.

- [In short](#in-short)
- [Payment](#payment)
- [Accounts](#accounts)
- [The separate program it runs: MEGAcmd](#the-separate-program-it-runs-megacmd)
- [Network use](#network-use)
- [Files outside the vault](#files-outside-the-vault)
- [Files in the vault](#files-in-the-vault)
- [No self-installation or self-updating](#no-self-installation-or-self-updating)
- [Telemetry](#telemetry)
- [Ads](#ads)
- [Source code and licences](#source-code-and-licences)
- [Desktop only](#desktop-only)
- [Node.js modules, clipboard and local storage](#nodejs-modules-clipboard-and-local-storage)
- [Security of the commands it runs](#security-of-the-commands-it-runs)

## In short

MEGA-Route is free and open source, shows no ads and collects nothing about you. It does its work by running **MEGAcmd**,
MEGA's official command-line program, which you install yourself; MEGAcmd does the syncing and is the only part that
talks to MEGA. The plugin itself opens no network connection.

## Payment

None. Every feature works without paying anyone. A MEGA account has free and paid plans; those are between you and MEGA.

## Accounts

The plugin has no account of its own. **Syncing needs a MEGA account** (MEGA's free plan works; its storage limit
applies), which MEGAcmd signs in to.

**Your MEGA email and password.** You type them in the plugin's settings (*Sign in to MEGA*). The plugin uses them for
one thing only: to pass them to MEGAcmd on this computer (`login <email> <password>`), which signs in with MEGA and keeps
its own session. The plugin:

- never stores them: not in `data.json`, not in Obsidian's local storage, not on disk, not in its log;
- never sends them anywhere else (the plugin has no network connection of its own);
- empties the password field the moment you press **Sign in**, and the other fields when the attempt ends;
- takes them out of every message, notice and log line, including MEGAcmd's own answers and MEGAcmd's log as shown in
  the log pane, where email addresses appear only masked (`s***@e***.com`).

A **two-factor code**, when MEGAcmd asks for one, is typed in a field that appears for it and written to MEGAcmd's input;
it is not stored either.

The password is passed as an argument of MEGAcmd's client program for the few seconds the sign-in takes, because
MEGAcmd's scriptable client accepts no other way (it refuses `login <email>` without a password outside its interactive
shell, which needs a console window). During those seconds, programs running as your Windows user, and administrators,
could read it from the process list; other users of the computer cannot. The details, and what MEGAcmd writes to its own
log: [Setting up → What happens to your password](setup.md#what-happens-to-your-password).

**The password is used once and never stored.** MEGAcmd saves a session (not the password) in its own folder
(`.megaCmd/session`) and resumes it whenever its server starts, so no password is needed again until that session ends
(signed out, closed from another MEGA app, or MEGAcmd's folder removed). Then the plugin says so once and waits for you
to sign in again; it never signs in by itself. Details: [Setting up](setup.md#megacmd-keeps-the-session-so-the-password-is-needed-once).

Once signed in, the plugin only asks MEGAcmd which account is signed in (`whoami`) and shows the address partly masked.

Versions 2.x asked for your MEGA email and password and stored them in `data.json`. Version 3 never uses them: it
**removes them from `data.json` by itself at its first start** (and from its backup of the 2.x settings, if any were
there), copies them nowhere, and writes one line to its log without any value; see
[Moving from version 2](moving-from-2.md).

**Signing out** (Settings → MEGA-Route → Sign out of MEGA) pauses the sync, cancels transfers in progress, then runs
MEGAcmd's `logout`, which ends the session at MEGA and deletes MEGAcmd's saved session and its syncs; files are not
touched. See [Setting up → Signing out](setup.md#signing-out).

## The separate program it runs: MEGAcmd

MEGA-Route needs [MEGAcmd](https://mega.io/cmd), published by MEGA (Mega Limited), installed separately by you. The
plugin runs MEGAcmd's **client program** (`MegaClient.exe` on Windows, `mega-exec` on macOS and Linux), which passes each
command to MEGAcmd's **background server**. It runs these MEGAcmd commands, and no others:

| Command | When | What it does |
|---|---|---|
| `version` | status checks every 5 minutes; **Start MEGAcmd** | MEGAcmd's version. MEGAcmd's client starts the server when it is not running, which is how **Start MEGAcmd** works. |
| `whoami` | status checks every 5 minutes; before creating the sync | which account is signed in |
| `login <email> <password>` | only when you press **Sign in**, and only while MEGAcmd's server runs | signs MEGAcmd in; a two-factor code, if MEGAcmd asks, goes to its input |
| `sync` (list) | each status check | the syncs MEGAcmd has, with their state |
| `transfers --summary` | status checks while the sync works | counts and sizes of transfers |
| `transfers --show-syncs --limit=3` | status checks while transfers run | the sync's running transfers: the file being transferred and how far |
| `sync-issues` | status checks while the sync reports issues | the issues' reasons |
| `ls <MEGA folder>` | the checks before creating the sync | what the MEGA folder holds |
| `mkdir -p <MEGA folder>` | only when you press **Create … on MEGA** in the dialog | creates the MEGA folder |
| `sync <vault folder> <MEGA folder>` | only when you confirm **Create the sync** | creates the sync |
| `sync -p` / `-e` / `-d <id>` | only when you press Pause, Resume or Remove | pauses, resumes or removes the sync (removing never deletes files) |
| `quit` | only when you confirm **Stop MEGAcmd** | stops MEGAcmd's server |
| `sync -p`, `transfers --limit=1000` (and `transfers -c -a` only if another transfer runs), `logout` | only when you confirm **Sign out** | pauses the sync, stops any other transfer, signs MEGAcmd out (its session and syncs deleted) |

It also lists running programs, with `tasklist` (Windows) or `ps` (macOS, Linux), to see whether MEGAcmd's server and
MEGA's desktop app are running. **No status check runs MEGAcmd while its server is stopped**, because MEGAcmd's client
would start it (and with it any sync). **The plugin never opens a window or a terminal**: every program it runs is
started hidden, with its input and output connected to the plugin.

**Nothing starts by itself when Obsidian starts**, unless you turn on *Start MEGAcmd with Obsidian* for that device.
MEGAcmd itself keeps running after Obsidian is closed, and keeps syncing while it runs: that is MEGAcmd's behaviour, and
how a sync normally works.

## Network use

**The plugin makes no network request.** MEGAcmd, a separate program, talks to MEGA's servers to sync your files; what
it sends, and MEGA's own privacy terms, are MEGA's: see MEGA's [privacy policy](https://mega.io/privacy) and
[terms](https://mega.io/terms). MEGA's files are end-to-end encrypted by MEGA's software before they leave your
computer.

The settings show links to MEGA's install page, MEGAcmd's user guide, MEGA's help page on `.megaignore` and this
documentation. They open in your browser only when you click them; the plugin fetches nothing.

## Files outside the vault

The plugin **reads** two things outside the vault and writes none:

- **MEGAcmd's server log**, to show it in the log pane while the settings tab is open: on Windows
  `%LOCALAPPDATA%\MEGAcmd\.megaCmd\megacmdserver.log` (beside MEGAcmd's programs), on macOS and Linux
  `~/.megaCmd/megacmdserver.log`. It is only read, never changed.
- **The presence of MEGAcmd's client program**, to check it is there before running it.

MEGAcmd, as a program you installed, keeps its own data outside the vault: its session, cache, sync configuration and
logs, in the `.megaCmd` folder above. Signing out in MEGAcmd (`logout`) clears its session and its syncs.

## Files in the vault

- **`.megaignore`** at the top of the vault: the plugin writes its exclusions into one block marked `# BEGIN MEGA-Route`
  … `# END MEGA-Route`, when you create the sync, when you change the exclusions while the sync exists, and when you
  press **Write to .megaignore now**. Every other line of the file is kept exactly as it was. MEGA's desktop app reads
  the same file when it syncs or backs up this folder. MEGA marks the file hidden; the plugin changes it in place, so it
  stays hidden, and reads it back to check (this write uses Node's `fs`; see
  [below](#nodejs-modules-clipboard-and-local-storage)). Before each change, the file as it was is copied to
  `megaignore-before-last-write.txt` in the plugin's folder.
- **`mega-route.log`** (and `mega-route.1.log`) in the plugin's folder: the plugin's own log, kept so it can be read
  after a reload; the same redacted lines as the log pane (no password, code or full address). At most about 2 MB.
- **`data.json`** in the plugin's folder: the settings that every device shares (the MEGA folder, the exclusions, the
  display switches). Nothing in it is ever run or used as a program's path.
- **`settings-2.x-backup.json`** in the plugin's folder, written once when settings from version 2 are moved: the old
  settings and sync state that no longer apply (without the sign-in data).
- **Per-device settings** (MEGAcmd's path, *Start MEGAcmd with Obsidian*, the check interval, the log pane's *Wrap
  lines*), and a note of a sign-out in progress, are kept through Obsidian's `App.saveLocalStorage` for this vault on
  this device, not in the vault.

The sync itself changes files in the vault, as any sync does: MEGAcmd downloads what changed on MEGA and applies
deletions made on MEGA (keeping deleted files in a hidden debris folder at the vault's top, MEGA's own safeguard).

## No self-installation or self-updating

The plugin never downloads, installs or updates anything, MEGAcmd included. You install MEGAcmd from MEGA; the settings
link to MEGA's page.

## Telemetry

None. The plugin's log stays on your computer: in memory (shown in its settings) and in `mega-route.log` in its folder.
It is never sent anywhere. The log pane's **Copy** button copies the lines to your clipboard when you press it; check them for paths
and addresses before you share them.

## Ads

None.

## Source code and licences

The plugin's source is in this repository, under the MIT licence; `main.js` is built from it with esbuild (see
[Building](building.md)). MEGAcmd is MEGA's program, under MEGA's licences, and is not part of this plugin; see
[Licence](licence.md).

## Desktop only

The manifest says `isDesktopOnly: true`: the plugin starts programs, which Obsidian on phones and tablets cannot. Should
it be loaded there anyway, it shows a note saying so and does nothing else.

## Node.js modules, clipboard and local storage

What Obsidian's automated review reports, and why each use is there.

**`child_process` (running programs).** The plugin exists to run MEGAcmd, so this cannot go. It runs **only MEGAcmd's
own client, which you install** (`MegaClient.exe` on Windows, `mega-exec` on macOS and Linux), and the system's process
list (`%SystemRoot%\System32\tasklist.exe` on Windows, `/bin/ps` elsewhere) to see whether MEGAcmd's server runs. **Never
a shell**: every process is started in one place, `src/core/runner.ts`, with `execFile` or `spawn`, an argument array
and `shell: false`, hidden, with a time limit and an output cap. The client's path must end in MEGAcmd's client name,
exist, and lie outside the vault (`src/core/locate.ts`, `checkClientPath`); it comes from MEGAcmd's usual install folder
or a per-device setting, never from `data.json`. There is no `exec`, `execSync` or `shell: true` anywhere (the tests
check the sources and the built `main.js`, `tests/noshell.test.ts`).

**`fs` (files).** Used only where Obsidian's vault API cannot do the job:

| Use | Where | Why not the vault API |
|---|---|---|
| Check that MEGAcmd's client program exists before running it (`stat`) | `src/core/locate.ts` via `src/main.ts` (`setupController`) | It is outside the vault, in MEGAcmd's install folder. |
| Read MEGAcmd's log file to show it in the log pane (`stat`, `open` read-only) | `src/core/log.ts` (`LogTail`) | It is outside the vault, in MEGAcmd's own folder. |
| Write `.megaignore` in place, and read it back to check (`open` with `r+`, `write`, `truncate`) | `src/core/fsio.ts` (`writeInPlace`) | MEGA marks `.megaignore` hidden. The vault API's write uses Node's `writeFile` (opened with "w", `CREATE_ALWAYS` on Windows), which Windows refuses for an existing hidden file (`EPERM`). Opening it with `r+` keeps the file and its attributes. |

Everything else goes through Obsidian's API (`src/core/vaultfs.ts`): reading `.megaignore`, the copy kept before each
write, the plugin's own log file (`DataAdapter.append`), `data.json` (`loadData`/`saveData`), the 2.x settings backup,
and counting the vault's files for the progress (`DataAdapter.list`, sizes from the vault's file list or
`DataAdapter.stat`). Node's modules are loaded in one place, `src/node.ts`, with `import()` behind Obsidian's `Platform.isDesktop` guard, and only on the desktop.

**Clipboard.** Only the log pane's **Copy** button uses it: when you press it, the lines shown are written to the
clipboard (`navigator.clipboard.writeText`). The plugin never reads the clipboard.

**Local storage.** Only through Obsidian's `App.loadLocalStorage` / `App.saveLocalStorage` (per vault, per device): the
per-device settings and the note of a sign-out in progress. The plugin does not use `window.localStorage` or
`sessionStorage` directly.

**Styles.** `styles.css` uses Obsidian's CSS variables and no `!important`; elements are shown and hidden with
Obsidian's `toggle`, `show` and `hide`.

## Security of the commands it runs

- Programs are started **directly, with an argument array, never through a shell** (`shell: false`), so no path or name
  is ever read as shell syntax; every call has a time limit and a cap on its output.
- MEGAcmd's path comes from the usual install location or a **per-device** setting, never from the vault's `data.json`
  (which other devices can change). It must be MEGAcmd's client by name, an existing file, and outside the vault.
- The MEGA folder comes from `data.json`, so it is **checked before every use**: it must be an absolute path in the Cloud
  Drive (not the Rubbish Bin `//bin`, the Vault `//in` or an incoming share), with no quotation mark, control character,
  `.`/`..` name or name starting with `-`. MEGAcmd's Windows client passes arguments on to its server as one line,
  quoting only those with spaces, so a quotation mark could otherwise split a path into extra arguments.
- Sync ids are checked against MEGAcmd's form; one starting with `-` is never passed (the vault's folder names the sync
  instead).
- Exclusion patterns are checked before they are written to `.megaignore`: no control characters, no pattern that would
  exclude the whole vault, at most 512 characters.
- The sign-in email and password are checked before MEGAcmd is run: no control characters; an email address only; no
  quotation mark, leading `-` (MEGAcmd would read an option), or leading `'` without a space (its server would strip it).
  Such values are refused with a message that does not repeat them. The two-factor code must be six digits.
- `MEGACMD_DO_NOT_REDACT_LINES` (which makes MEGAcmd's server log sign-in commands in full) is removed from the
  environment of every MEGAcmd call.
- No `eval`, no `new Function`. The tests check all of this (see [Building and testing](building.md)).
