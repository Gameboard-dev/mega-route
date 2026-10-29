# Settings

[← README](../README.md)

Settings → MEGA-Route, from top to bottom. Settings marked **(this device)** are kept in Obsidian's local storage for
this vault on this computer, never in the vault, so other devices that sync the vault neither see nor change them. All
others are in the plugin's `data.json` and are shared by every device that syncs the vault.

- [MEGAcmd](#megacmd)
- [The sync](#the-sync)
- [Exclusions](#exclusions)
- [Status bar and ribbon](#status-bar-and-ribbon)
- [Logs (the live log pane)](#logs-the-live-log-pane)
- [Contents](#contents)

## MEGAcmd

A panel that shows, with a coloured dot each:

| Row | Shows | Buttons |
|---|---|---|
| Program | where MEGAcmd's client is, and its version; or why it was not found | links to MEGA's install page and MEGAcmd's user guide |
| Server | whether MEGAcmd's background server runs | **Start MEGAcmd** / **Stop…** |
| Account | the signed-in account, partly masked (`s***@e***.com`), or *Not signed in* | |
| MEGA desktop app | whether MEGA's desktop app (MEGAsync) is running | |
| Now | the sync's state in a sentence | refresh |

Below the panel, **Sign in to MEGA**: an email field, a password field, an optional **One-time code** field (only if
two-factor authentication is on; it is highlighted when MEGAcmd asks for a code) and **Sign in**. The form is greyed
out, with the reason, while MEGAcmd is missing, stopped or already signed in. Nothing typed there is saved; see
[What happens to your password](setup.md#what-happens-to-your-password).

**Greyed out**: while MEGAcmd is not installed, every control that needs it (Start, sign-in, create, pause, resume,
remove) is greyed out, and the reason shows on hover and under it: *MEGAcmd is not installed. Install it from
https://mega.io/cmd, then restart Obsidian or set MEGAcmd's folder in these settings.* While MEGAcmd's server is not
running, the sign-in and the sync's controls say *Start MEGAcmd first*. The plugin looks for MEGAcmd again each time the
settings open.

| Setting | What it does | Default |
|---|---|---|
| MEGAcmd's folder (this device) | MEGAcmd's folder, or its client program (`MegaClient.exe` on Windows, `mega-exec` on macOS and Linux). Empty: the usual place. **Check** looks again. Must lead to MEGAcmd's client, an existing file, outside the vault. | empty |
| Start MEGAcmd with Obsidian (this device) | When Obsidian starts, start MEGAcmd's server if it is not running, which resumes MEGAcmd's syncs. Off: MEGAcmd runs only when you start it. | off |
| Status checks while idle (this device) | Seconds between status checks while the sync is idle and Obsidian has the focus, 10 to 600. While the sync works the plugin checks every 5 s; while Obsidian is in the background and the sync is idle, not at all. | 30 |

## The sync

| Setting | What it does | Default |
|---|---|---|
| MEGA folder | The MEGA folder the vault syncs with, from the top of the Cloud Drive (`/RAG`, `/Notes/My vault`). Used when the sync is created. A wrong value is explained under the field. | `/` + the vault's name |

Below it: the vault's sync (its id, folders, state, status, and what MEGA holds) with **Pause** / **Resume** and
**Remove…**, or, with no sync yet, **Check and create…**. MEGAcmd's other syncs on the computer are listed for
information. See [The sync](the-sync.md).

## Exclusions

| Setting | What it does | Default |
|---|---|---|
| Leave out | Glob patterns of vault paths to keep out of the sync, one per line. | `.git/**`, `node_modules/**` |
| Sync even so | Patterns of paths to sync even when another rule leaves them out. | empty |
| Sync Obsidian's settings folder | Brings `.obsidian` back into the sync (MEGA's default rules leave out names starting with a dot). The window layout and this plugin's folder stay out. | on |
| MEGA-Route's block in .megaignore | **Write to .megaignore now**; below it, the rules that will be written and, in red, only the patterns that cannot be written (a pattern that would leave out the whole vault or `.obsidian`, a control character, too long). A pattern with `*` or `?` is written as a `-pr:` rule that keeps `*` within one name; a muted line under the box says so once. | |

How patterns become MEGA rules, and when the file is written: [Exclusions and .megaignore](the-sync.md#exclusions-and-megaignore).

## Status bar and ribbon

| Setting | Default |
|---|---|
| Show in the status bar | on |
| Show the ribbon icon | on |

## Logs (the live log pane)

A scrollable pane, built into the settings tab, that shows **MEGA-Route's own log** (every MEGAcmd command it ran, with
the result and time taken; checks; changes; failures, each with what, where and why) and **MEGAcmd's server log** as
MEGAcmd writes it. It updates while the settings tab is open:

- MEGAcmd's log is read from its file once a second (at first its last 64 KB), only while the pane is open. Its path is
  shown under the pane.
- **Lines to show**: *Everything*, *MEGA-Route only*, *MEGAcmd only*, or *Syncs and transfers* (MEGAcmd's lines about
  syncs, transfers, uploads, downloads, stalls and `.megaignore`, with MEGA-Route's lines other than its debug lines).
- **Follow new lines**: keep the newest line in view. Off: the pane stays where you scrolled.
- **Wrap lines** (this device; on by default): long lines wrap, long paths and ids included. Off: each line stays on
  one line and the pane scrolls sideways as well.
- **Copy** copies the lines shown to the clipboard. **Clear** empties the pane (and the plugin's in-memory log); no
  file is changed.
- The pane keeps the last 2,000 lines; its height can be dragged.

The pane starts afresh each time Obsidian starts; the plugin's lines are also kept in `mega-route.log` in its folder,
to read after a reload. How much MEGAcmd writes to its own log is
MEGAcmd's setting: see [Status and logs](status-and-logs.md#megacmds-log).

## Contents

Where the window is at least 1000 pixels wide (desktop), a **Contents** column on the left lists every section of the
tab and stays in view as the settings scroll; clicking a section scrolls to it. In narrower windows the same links
show in a line above the settings.
