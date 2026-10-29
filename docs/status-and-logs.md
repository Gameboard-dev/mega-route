# Status and logs

[← README](../README.md)

- [The status bar and the ribbon](#the-status-bar-and-the-ribbon)
- [The states](#the-states)
- [The progress](#the-progress)
- [The menu and the commands](#the-menu-and-the-commands)
- [When the status is checked](#when-the-status-is-checked)
- [The logs](#the-logs)
- [MEGAcmd's log](#megacmds-log)

## The status bar and the ribbon

The status bar shows a coloured dot and a few words, such as `MEGA: synced` or `MEGA: syncing 46%`. The ribbon icon (a
cloud) takes the same colour, and during a run with a percentage a thin gauge under it fills with it. Hovering over
either shows the state in a full sentence, for example *Syncing: 3,120 of 6,772 files (46%), 512 MB of 1.1 GB in sync;
3,652 files to upload, 612 MB left.* Clicking either opens the same menu.

## The states

| Dot | Status bar | Meaning |
|---|---|---|
| green | `synced` | MEGAcmd reports the sync up to date (`Running`, `Synced`): *In sync, 100%*, with the files and size on MEGA. |
| accent | `syncing p%` | A run with many files to do: files in sync ÷ files the sync covers (see [The progress](#the-progress)). |
| accent | `syncing: n files to upload` | A run with a few files to do (edits, a new note): the files still to upload or download. |
| accent | `scanning` | MEGA's engine is comparing the vault with MEGA and has not queued transfers yet. |
| accent | `starting` / `checking` | The sync is loading (`Pending` or `Loading`), or reports no status yet. |
| yellow | `paused` | The sync is paused (`Disabled` or `Suspended`). |
| orange | `n sync issues` | MEGA's engine stopped on items it will not decide alone; see [Sync issues](troubleshooting.md#sync-issues). |
| orange | `not signed in` | MEGAcmd is not signed in. |
| orange | `status unknown` | A check failed (the reason is in the tooltip and the log). |
| red | `error: CODE` | MEGAcmd reports an error for the sync, with MEGA's code (for example `LOCAL_PATH_UNAVAILABLE`). |
| grey | `no sync` | MEGAcmd has no sync of this vault. |
| grey | `MEGAcmd not running` | MEGAcmd's server is stopped, so no sync runs. |
| grey | `MEGAcmd not found` | MEGAcmd's client program was not found. |

The words in brackets are MEGAcmd's own: its `sync` command reports a *run state* (`Pending`, `Loading`, `Running`,
`Suspended`, `Disabled`) and a *status* (`NONE`, `Synced`, `Pending`, `Syncing`, `Processing`), and an *error* column.

## The progress

The percentage is **files in sync ÷ files the sync covers**, rising from 0% to 100% as files are uploaded or downloaded,
and never going back during a run:

- **Files the sync covers**: the vault's files that the `.megaignore` rules let through, counted by the plugin with a
  walk of the vault through Obsidian's file API (names and sizes only, no file is read), with the rules evaluated as
  MEGA's engine does. Symbolic links are counted as what they point to (MEGA does not sync them). It is
  counted when a run starts, and again at most once a minute while the sync works, only if the vault changed; never
  while the sync is idle. If something cannot be evaluated exactly (size limits, `.megaignore` files inside
  sub-folders, an unusual regular expression), the tooltip says the count is approximate and the log says why.
- **Files in sync**: the number of files in the sync's MEGA folder, from the FILES column of MEGAcmd's `sync` list,
  which the status check reads anyway. MEGAcmd counts them from the file tree it keeps in memory (no request to MEGA,
  no extra cost), and MEGA adds a file only when its upload has completed.
- In sync, both sides hold the same files, so the smaller of the two counts over the larger rises to 100% whether files
  are going up (MEGA's count rising to the vault's) or coming down (the vault's rising to MEGA's). The plugin keeps the
  highest value of the run, so it never shows a step back, and shows 100% only when MEGAcmd reports the sync in sync.
- A run with fewer than 50 files to do shows the files to upload or download instead (`syncing: 1 file to upload`),
  not 99.98%.
- The queue of transfers (`transfers --summary`) is shown as *files to upload, … left* in the tooltip, never as a
  percentage: it is MEGAcmd's queue of the moment, whose total grows while MEGA's engine is still adding files and
  shrinks as transfers finish, so its done ÷ total goes up and down. It counts all of MEGAcmd's transfers, those of
  other MEGAcmd syncs included.
- If the MEGA folder holds files the vault leaves out (for example files that an exclusion keeps on MEGA), the
  percentage can stop short of 100% until MEGAcmd reports the sync in sync.

**Activity, so a run never looks frozen.** The file percentage stands still while one large file uploads (it counts
whole files). Beside it the status bar shows the rate over the last minute (`syncing 57% · 1.3 MB/s`, from the bytes
arriving on MEGA), and the tooltip names what is being transferred and how far (*Now uploading Lecture 3.pdf (70%)*,
from MEGAcmd's list of the sync's running transfers, `transfers --show-syncs --limit=3`). The percentage stays by
files, as asked; the bytes show in the tooltip (*512 MB of 1.1 GB*) and in the rate.

**No progress.** If nothing has moved for 2 minutes (no file or byte added on MEGA, no file in the vault, no change in
the running transfers' progress), the status bar says so (`syncing 57%, no progress 2 min`) and the tooltip gives
MEGAcmd's reason: a transfer RETRYING (MEGA or the network refusing it for now), transfers PAUSED or only QUEUED, or
the sync's status with nothing queued (MEGA's engine scanning or comparing). Sync issues are shown as such (orange). A
paused sync shows `paused`, not a percentage.

## The menu and the commands

The ribbon icon and the status bar open one menu: the state; **Refresh status**; **Pause the sync** or **Resume the
sync**; **Create the sync…** (when there is none and MEGAcmd is ready); **Start MEGAcmd** or **Stop MEGAcmd…**; **Sign in
to MEGA…** (when MEGAcmd is not signed in; opens the settings, where you sign in); **Settings and logs**.

Commands (command palette): *Refresh the sync's status*, *Pause the sync*, *Resume the sync*, *Open settings and logs*.

## When the status is checked

- while the sync is working: every 5 seconds;
- while it is idle and Obsidian has the focus: every 30 seconds (*Status checks while idle*), and at once when Obsidian
  gets the focus back;
- while it is idle and Obsidian is in the background: not at all;
- the version and the account: every 5 minutes, when the settings open, and on **Refresh**.

Each check first looks at the list of running programs. Only if MEGAcmd's server is running does it ask MEGAcmd
(`sync`, and `transfers --summary` while working); otherwise it would start the server.

## The logs

Both are in the live pane at the bottom of the settings tab ([Settings → Logs](settings.md#logs-the-live-log-pane)):

- **MEGA-Route's log file**: the same lines, with the date, are also written to `mega-route.log` in the plugin's folder
  (`.obsidian/plugins/mega-route/`; cut over to `mega-route.1.log` at 1 MB; never synced), so what happened before a
  reload (a sign-out cut short, a run that seemed to stop) can be read afterwards.
- **MEGA-Route's log**: each MEGAcmd command run (its arguments, exit code and time taken; the output's first lines when
  it failed), each check and its findings, each change (sync created, paused, removed; `.megaignore` written), each
  change of state, and every failure with what failed, where and why. The pane keeps the last 2,000 lines; the
  log file above keeps more. The account's address never appears in full, and a sign-in is logged as `MEGAcmd login s***@e***.com
  [password]`: the password and any two-factor code never appear.
- **MEGAcmd's log**: MEGAcmd's server log file, followed while the pane is open. Before a line is shown, sign-in
  commands (`login …`, `passwd …`, `confirm …`), `--password=`, `--auth-code=` and `--auth-key=` values, two-factor codes
  ("Using confirmation pin: …", written at MEGAcmd's `verbose` level) and long session strings are replaced by
  `[redacted]`, and email addresses are masked. The file itself is MEGAcmd's and is not changed.

## MEGAcmd's log

MEGAcmd writes its server log to:

| System | File |
|---|---|
| Windows | `%LOCALAPPDATA%\MEGAcmd\.megaCmd\megacmdserver.log` |
| macOS, Linux | `~/.megaCmd/megacmdserver.log` |

MEGAcmd rotates the file as it grows; the pane notices and starts again from the new file's top. How much MEGAcmd writes
is MEGAcmd's own setting, changed in MEGAcmd with its `log` command (levels `fatal`, `error`, `warning`, `info`, `debug`,
`verbose`): `log` shows the current levels (note them first, to go back to them later), `log -s debug` makes the sync
engine (the "SDK") write more, `log -c debug` MEGAcmd itself. More detail helps when looking into a problem, and makes
the file grow faster. MEGAcmd keeps the setting until you sign out.

The log can hold file names and your account's address: check it before you share it.
