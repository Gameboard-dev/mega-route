# MEGA-Route

**Keeps your Obsidian vault in a two-way sync with a folder on MEGA, run by MEGA's own command-line tool, MEGAcmd.**

The sync itself is done by [MEGAcmd](https://mega.io/cmd), MEGA's official command-line program, with the same sync
engine as MEGA's desktop app. MEGA-Route sets the sync up from Obsidian, checks it before it starts, writes your
exclusions as MEGA rules, and shows how the sync is doing in the status bar, the ribbon and a live log in its settings.
It never copies, uploads or deletes a file itself.

> **Not affiliated.** MEGA-Route is not made, endorsed or supported by MEGA (Mega Limited) or by Obsidian. MEGA, MEGAcmd
> and MEGAsync are MEGA's names for their products.

## Disclosures (Obsidian's developer policies)

What MEGA-Route runs, sends and stores, as Obsidian's
[Developer policies](https://docs.obsidian.md/community-directory/developer-policies) ask, is set out item by item in
**[docs/disclosures.md](docs/disclosures.md)**. In short:

- **Payment**: none. The plugin is free and open source (MIT).
- **Account**: a **MEGA account is required** (MEGA's free plan works). The plugin has no account of its own.
- **A separate program**: it runs **MEGAcmd**, MEGA's official command-line tool, which you install yourself from
  [mega.io/cmd](https://mega.io/cmd). The plugin never downloads or installs anything, and never opens a window or
  terminal.
- **Your MEGA password**, typed in the plugin's settings, is passed only to MEGAcmd on this computer, which signs in and
  keeps its own session. The plugin never stores it, logs it or sends it anywhere else
  ([how](docs/setup.md#what-happens-to-your-password)).
- **Network use**: the plugin makes no network connection of its own. The sync's traffic is MEGAcmd's, to MEGA's
  servers, end-to-end encrypted by MEGA's software.
- **Files outside the vault**: the plugin reads MEGAcmd's log file (in MEGAcmd's own folder) to show it, and checks that
  MEGAcmd's program is there. MEGAcmd keeps its session and settings in its own folder.
- **Node.js `child_process`**: it runs only MEGAcmd's own client, which you install (`MegaClient.exe` on Windows,
  `mega-exec` on macOS and Linux), and the system's process list (`tasklist`, `ps`) to see whether MEGAcmd runs; never
  a shell, always an argument array with `shell: false`.
- **Node.js `fs`**: only where Obsidian's vault API cannot do the job: reading MEGAcmd's log and checking its program
  (both outside the vault), and writing `.megaignore` in place (MEGA marks it hidden, and the vault API's write cannot
  replace a hidden file on Windows). Everything else in the vault goes through Obsidian's API.
- **Clipboard**: written only when you press **Copy** in the log pane; never read.
- **Desktop only**: it starts a program, which Obsidian on phones and tablets cannot.
- **No telemetry, no ads.**

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Documentation](#documentation)
- [History and credits](#history-and-credits)
- [Licence](#licence)

## What it does

- **Setup panel**: finds MEGAcmd, shows its version, whether its background server runs, and which account it is signed
  in to (shown partly masked). Starts and stops MEGAcmd's server, and signs MEGAcmd in to your MEGA account from the
  settings (with the two-factor code when MEGAcmd asks for one), and out again (transfers cancelled first). Greyed out,
  with the reason, until MEGAcmd is installed and running.
- **One-button sync, checked first**: the vault ↔ a MEGA folder (`/<vault name>` by default). Before anything is
  created it checks that MEGAcmd runs and is signed in, that the MEGA folder exists and what it holds, that no other sync
  covers the vault or the folder, and whether MEGA's desktop app is running; then it shows what will happen and waits
  for you to confirm.
- **Pause, resume, remove**, from the ribbon, the status bar, the settings or the command palette. Removing a sync never
  deletes a file.
- **Exclusions as MEGA rules**: your patterns, written into a marked block of `.megaignore` at the top of the vault,
  with fixed rules that always keep out Obsidian's window layout, `.trash` and the plugin's own folder.
- **Status**: a coloured dot and a few words in the status bar (synced, syncing with counts and progress, paused,
  issues, error with the reason), the same colour on the ribbon icon, checked every few seconds while the sync works
  and only while Obsidian has the focus otherwise.
- **Live logs**: the plugin's own log and MEGAcmd's server log, as they grow, in a scrollable pane in the settings, with
  a filter, follow-new-lines and copy.

## Requirements

- **Obsidian's desktop app** (version 1.8.7 or later). Windows is tested; macOS and Linux are written for but not yet
  tested. Not for Obsidian on phones and tablets (use MEGA's mobile app there).
- **[MEGAcmd](https://mega.io/cmd)** 2.x, installed by you, from MEGA.
- **A MEGA account.**

## Installation

MEGA-Route is not in Obsidian's list of community plugins. Install it by hand:

1. Install MEGAcmd from [mega.io/cmd](https://mega.io/cmd) (on Windows it goes to `%LOCALAPPDATA%\MEGAcmd`).
2. Create `<vault>/.obsidian/plugins/mega-route/` and copy `main.js`, `manifest.json` and `styles.css` from this
   repository (or a release) into it.
3. Turn on **MEGA-Route** in Settings → Community plugins.

Coming from version 2.x? Read [Moving from version 2](docs/moving-from-2.md) first.

## Quick start

1. Settings → MEGA-Route → **MEGAcmd**: press **Start MEGAcmd**, then under **Sign in to MEGA** type your MEGA email
   and password and press **Sign in** (and the two-factor code, if MEGAcmd asks for one).
2. If MEGA's desktop app is running, make sure it does not sync or back up this vault's folder
   ([why](docs/troubleshooting.md#one-sync-engine-per-folder)).
3. Under **The sync**, set the **MEGA folder**, then press **Check and create…**, read the checks and confirm.
4. Watch the status bar: `MEGA: scanning`, then `MEGA: syncing 3%` rising to `MEGA: synced`.

## Documentation

| Page | What it covers |
|---|---|
| [Disclosures and compliance](docs/disclosures.md) | MEGAcmd as a separate program, network use, files outside the vault, accounts, telemetry, each of Obsidian's rules |
| [Setting up MEGAcmd](docs/setup.md) | Installing MEGAcmd, its server, signing in, where the plugin looks for it |
| [The sync](docs/the-sync.md) | Creating, pausing, resuming and removing the sync; what two-way means; exclusions and `.megaignore` |
| [Settings](docs/settings.md) | Every setting, which are kept per device, and the log pane |
| [Status and logs](docs/status-and-logs.md) | The status bar, the ribbon menu, the states and what they mean, the logs and where they are |
| [Troubleshooting](docs/troubleshooting.md) | One engine per folder, MEGA's desktop app, sync issues, common messages |
| [Moving from version 2](docs/moving-from-2.md) | What changed, what was carried over, where 2.x's files are, clearing the old sign-in data |
| [Building and testing](docs/building.md) | Building `main.js`, the tests and the fake MEGAcmd, the code's layout |
| [Licence](docs/licence.md) | The plugin's licence, and MEGAcmd's |

## History and credits

MEGA-Route started as a set of changes to [MEGA Sync](https://github.com/ledokter/obsidian-mega-sync) by ledokter
(versions 2.x, kept apart from this repository). Version 3 is a **new implementation**, written from scratch: the sync is
MEGAcmd's, and no code of MEGA Sync or of 2.x is in it. Thanks to ledokter for the plugin this one started from.

**How it differs from MEGA Sync** (in Obsidian's community plugins): MEGA Sync, as of its version 2.4.0, syncs with its
own engine inside Obsidian, signing in itself and keeping your credentials in its settings. MEGA-Route has no sync
engine: MEGA's own client, MEGAcmd, does the syncing, continuously and outside Obsidian, with MEGA's sync engine and
`.megaignore` rules; the plugin sets it up, checks it before it starts, and shows its state and logs. It stores no MEGA
credentials.

## Licence

MIT ([LICENSE](LICENSE)). MEGAcmd is MEGA's and has its own licence; it is not part of this plugin. Details:
[Licence](docs/licence.md).
