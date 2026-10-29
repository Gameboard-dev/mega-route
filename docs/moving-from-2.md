# Moving from version 2

[← README](../README.md)

Versions 2.x (a fork of MEGA Sync 2.4.0) synced with their own engine inside Obsidian: they logged in to MEGA with your
email and password, compared the vault with a snapshot, and uploaded, downloaded and deleted files themselves. Version 3
hands all of that to MEGAcmd.

**The plugin's id changed** from `mega-sync-fork` (versions 2.x to 3.0.1) to `mega-route` (from 3.0.2), so its folder is
now `<vault>/.obsidian/plugins/mega-route/`. Obsidian keeps a plugin's settings in its folder, so the folder is moved
by hand, once, with `data.json` in it (below). The plugin does not move it itself: a plugin should not move another
plugin's folder, and Obsidian would load both meanwhile.

- [Before you update](#before-you-update)
- [What happens to the settings](#what-happens-to-the-settings)
- [What 2.x left behind](#what-2x-left-behind)
- [The old sign-in data](#the-old-sign-in-data)
- [The first sync with MEGAcmd](#the-first-sync-with-megacmd)

## Before you update

1. Let any 2.x sync finish, or stop it.
2. In Settings → Community plugins, turn the old plugin off.
3. Quit Obsidian. Rename the folder `<vault>/.obsidian/plugins/mega-sync-fork` to `mega-route` (its `data.json` goes
   with it), and put the new `main.js`, `manifest.json` and `styles.css` in it.
4. Start Obsidian and turn on **MEGA-Route** in Settings → Community plugins. Version 3 starts no sync on its own.

On other devices that sync the vault, do the same. Until a device is moved, the fixed exclusions keep both folders out
of the sync.

## What happens to the settings

At the first start, version 3 moves the settings, once:

| 2.x | 3.0 |
|---|---|
| Base folder (+ Remote sub-folder) | **MEGA folder**: `RAG` becomes `/RAG`, `Base` + `Sub` becomes `/Base/Sub` |
| Exclude patterns, Include patterns | **Leave out**, **Sync even so** (now written as MEGA rules) |
| Sync vault config | **Sync Obsidian's settings folder** |
| Show status bar, Show ribbon | the same |
| Ignore paths (regex), Only allow paths (regex) | not carried over (MEGA's rules are not JavaScript regular expressions); the log says so if they were set |
| everything else (direction, intervals, sync on save, deletion limits, parallel uploads, the snapshot, the log, …) | dropped: MEGAcmd's engine works differently |

Before `data.json` is rewritten, the dropped settings and sync state are saved to `settings-2.x-backup.json` in the
plugin's folder (without the sign-in data). If that file cannot be written, `data.json` is left unchanged and the move is
tried again at the next start. If version 3.0.0 or 3.0.1 already ran, the move is done and is not repeated.

## What 2.x left behind

Nothing of these is used by version 3, and none is synced (the fixed exclusions keep them out). Paths are in the
plugin's folder, `.obsidian/plugins/mega-route/` (or `mega-sync-fork/` if not moved yet):

| What | Where | What to do |
|---|---|---|
| The settings backup | `settings-2.x-backup.json` | Keep it while you might go back to 2.x; then delete it. |
| The deletion bin (vault side) | `bin/` | Files 2.x deleted from the vault waited here to be restored. Look inside before deleting the folder; restore anything you want by moving it back into the vault. |
| The deletion bin (MEGA side) | `.mega-sync-bin` inside the old base folder on MEGA | Files 2.x deleted on MEGA waited here. Look in MEGA's apps before deleting it. |
| The text-merge cache | `merge-cache/` | Can be deleted. |
| The sync snapshot | `_mega_sync_snapshot.json` in the old base folder on MEGA | Can be deleted. |
| The lock file | `instance-lock.json` | Can be deleted. |

## The old sign-in data

Versions 2.x kept your MEGA email, password and session in `data.json`, **in plain text unless you had set a settings
password** (encrypted then). Version 3 never uses them (MEGAcmd keeps its own session), so **it removes them by itself
at its first start** (from 3.0.6): the email, password, two-factor code, session, settings passphrase and their
encrypted form. They are copied nowhere, also not into `settings-2.x-backup.json` (any found there are removed too),
and the log says only "Removed the sign-in data version 2 stored in data.json". Every other setting is kept as it was.
Going back to 2.x then asks you to sign in again.

If the vault (and `data.json` with it) was synced to other places while it held the password, consider changing your
MEGA password.

## The first sync with MEGAcmd

2.x's upload-only runs left the MEGA folder with copies of the vault's files, and sometimes files that no longer exist
in the vault. A two-way sync merges both sides, so **files that exist only on MEGA come back into the vault**. Before
**Check and create…**:

- look at the MEGA folder in MEGA's apps, and remove what you do not want back in the vault; or
- create the sync with a new, empty MEGA folder (set *MEGA folder*, and use **Create … on MEGA** in the dialog), which
  uploads the vault afresh.

Also make sure MEGA's desktop app does not sync or back up the vault's folder ([one engine per
folder](troubleshooting.md#one-sync-engine-per-folder)). There is no "Sync now" any more: the sync runs continuously in
MEGAcmd while its server runs.
