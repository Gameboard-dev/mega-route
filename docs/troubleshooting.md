# Troubleshooting

[← README](../README.md)

- [One sync engine per folder](#one-sync-engine-per-folder)
- [MEGA's desktop app (MEGAsync)](#megas-desktop-app-megasync)
- [Sync issues](#sync-issues)
- [Messages](#messages)
- [Known limits](#known-limits)

## One sync engine per folder

**Never let two sync engines work on the same folder**: not MEGAcmd and MEGA's desktop app, not two MEGAcmd syncs, not
MEGAcmd and another sync program (or MEGA-Route 2.x). Each engine keeps its own record of what it synced; each sees the
other's uploads, downloads and deletions as new changes, and the two can pass files and deletions back and forth.

MEGA-Route checks what it can before creating the sync: MEGAcmd's own syncs of the vault, of a folder containing it or
inside it, and of the MEGA folder. It **cannot see MEGA's desktop app's syncs and backups** (the desktop app has no
interface for other programs, and keeps its settings encrypted), so when the desktop app is running it warns you, and
you check.

## MEGA's desktop app (MEGAsync)

MEGAcmd and MEGA's desktop app can run on the same computer; each has its own session. What matters is that they never
work on the same folder. In the desktop app, open **Settings → Sync** and **Settings → Backup** (the names vary a little
between versions) and look at each local folder:

- **A sync of the vault's folder, or of a folder that contains it** (for example the folder above the vault): remove
  that sync in the desktop app before you create MEGA-Route's sync, or do not create MEGA-Route's sync.
- **A backup of the vault's folder** (MEGA's one-way backups, kept in your MEGA account's *Backups*): a backup only
  uploads; it never changes the vault. With MEGAcmd also syncing the folder, two engines read it, the backup also stores
  everything the sync downloads, and both read the same `.megaignore` (so MEGA-Route's block applies to the backup too).
  This is not two engines writing to one folder, but it doubles the uploads and the space used; decide whether you
  still want the backup, and remove it in the desktop app if not.
- **Syncs of other folders** (not containing the vault) are fine.

If the vault's folder sits inside another folder that the desktop app syncs, the desktop app and MEGAcmd would both work
on the vault; that is the case to avoid above all.

## Sync issues

MEGA's engine stops on items it will not decide alone and reports them as **sync issues**, for example a file changed on
both sides since the last sync, two names that differ only in case, a name not allowed on one side, or a `.megaignore`
line it cannot read. The rest of the sync carries on. The status bar shows `n sync issues` with the first reason in its
tooltip.

To see and settle them, open MEGAcmd yourself (from the Start menu on Windows, or `mega-sync-issues` in a terminal) and
run `sync-issues`, then `sync-issues --detail --all` for the paths involved. Settle each by keeping the version you
want (rename, move or delete the other, in the vault or in MEGA's apps). See MEGAcmd's
[sync-issues](https://github.com/meganz/MEGAcmd/blob/master/contrib/docs/commands/sync-issues.md).

## Messages

| Message | Cause | What to do |
|---|---|---|
| MEGAcmd not found: Not found: …\MegaClient.exe | MEGAcmd is not installed, or not in the usual place. | Install it from [mega.io/cmd](https://mega.io/cmd), then reopen the settings (the plugin looks again), or set *MEGAcmd's folder (this device)* and press **Check**. |
| The file must be MEGAcmd's client program … | The path names another program. | Point it at `MegaClient.exe` (Windows) or `mega-exec`. |
| MEGAcmd must not be run from inside the vault. | The path is inside the vault. | Install MEGAcmd outside the vault. |
| MEGAcmd not running | Its server is stopped. | **Start MEGAcmd**. |
| not signed in | MEGAcmd has no session. | Sign in under **Sign in to MEGA** ([Setting up](setup.md#sign-in)). |
| Start MEGAcmd first | The sign-in or the sync's controls need MEGAcmd's server. | **Start MEGAcmd**; it may then show *Signed in* already. |
| MEGA did not accept that email and password | MEGA refused them (MEGAcmd: `Login failed: invalid email or password`). | Check both and try again; the email is the one you sign in to MEGA with. |
| That code was not accepted (in the code field) | The code was wrong, or expired while you typed it. | Type the next code; the password is not needed again (up to three codes). |
| The two-factor code was not accepted 3 times | Three codes in a row failed. | Check that your authenticator app's (and your computer's) clock is right, then sign in again. |
| MEGA has suspended the account until it is verified | MEGA blocked the account until you verify by email or phone. | Verify as MEGA's message says (its email, or mega.nz), then sign in again. |
| MEGA refuses sign-ins for this account for now: too many attempts | Too many sign-ins in a short time. | Wait, then try again. |
| syncing 57%, no progress 2 min | Nothing moved for 2 minutes; the tooltip gives MEGAcmd's reason (RETRYING, PAUSED, QUEUED, or scanning). | A RETRYING transfer usually resumes by itself; otherwise look at MEGAcmd's log in the pane, and at sync issues. |
| The last sign-out did not finish | Obsidian closed or reloaded during a sign-out; MEGAcmd is still signed in and the sync may be paused. | Sign out again, or resume the sync. |
| … is in progress: wait for it to finish | One action at a time (sign-in, sign-out, creating, pausing …): another was refused. | Wait for the section's step indicator to finish. |
| MEGA-Route is signed out of MEGA, so nothing syncs | MEGAcmd's session ended (signed out in MEGAcmd, closed from another MEGA app, or MEGAcmd's folder removed). | Sign in again in the settings. The plugin keeps no password and never signs in by itself. |
| Sign-in stopped: no two-factor code was given | You pressed Cancel, or the code was not six digits. | Sign in again with your authenticator app at hand. |
| This MEGA account is not confirmed yet | MEGA's confirmation email was not opened. | Open the link in MEGA's email, then sign in again. |
| MEGAcmd is already signed in | MEGAcmd has a session. | Nothing to do. To use another account, run `logout` in MEGAcmd first (that also removes its syncs). |
| MEGAcmd did not finish signing in within 3 minutes | A large account's file tree is still loading, or MEGA is slow. | Press Refresh in a minute; if it stays signed out, try again. |
| The password contains a quotation mark / starts with - / starts with ' | MEGAcmd's command-line client cannot pass such a password unchanged. | Sign in once in MEGAcmd itself ([how](setup.md#what-happens-to-your-password)), then press Refresh. |
| The email address contains … / That is not an email address MEGA would accept | The email field holds something else. | Type the address alone. |
| status unknown: … did not answer within the time limit | MEGAcmd was busy (for example loading a large account after starting). | Wait and refresh; if it lasts, look at MEGAcmd's log in the pane. |
| Could not list running programs with …tasklist.exe | Windows' process list could not be read. | Check that `%SystemRoot%\System32\tasklist.exe` runs; the plugin asks MEGAcmd nothing until it can tell whether the server runs. |
| /X does not exist on MEGA. | The MEGA folder is missing. | Use **Create /X on MEGA** in the dialog, or create it in MEGA's apps, or correct *MEGA folder*. |
| MEGAcmd already syncs this vault / a folder that contains the vault / a folder inside the vault | An existing MEGAcmd sync covers the vault. | Remove that sync in MEGAcmd (`sync`, then `sync -d <id>`), or keep it and do not create another. |
| The MEGA folder /X is already in another of MEGAcmd's syncs | Another local folder syncs with it, or with a folder inside or around it. | Choose another MEGA folder. |
| The MEGA folder … contains a quotation mark / must start with / / cannot be the whole Cloud Drive / … | The *MEGA folder* setting cannot be used. | Correct it as the message says. |
| error: LOCAL_PATH_UNAVAILABLE (or another code) | MEGA's engine stopped the sync, for example because the vault's folder was moved or a drive is missing. | Fix the cause, then **Resume**; if it stays, remove and create the sync again. MEGAcmd's log has the details. |
| Sync added as temporarily disabled. Reason: … | MEGAcmd created the sync but could not start it. | Read the reason; fix it; **Resume**. |
| Exclusion not written: "…" would leave out the whole vault | A pattern such as `*`. | Remove it, or make it narrower. |
| Could not write …\.megaignore: EPERM / EACCES | Windows refused to change the file. (Before 3.0.5 this happened whenever MEGA had marked the file hidden; the plugin now writes it in place, which works on hidden files.) | Check that the file is not read-only (Properties) and not held open by another program, then try again. Its previous content is in `megaignore-before-last-write.txt` in the plugin's folder. |
| Could not write …: EBUSY | Another program (MEGA's desktop app, an antivirus) has the file open. | Wait a moment and try again. |

## Known limits

- **Tested on Windows.** The macOS and Linux paths follow MEGAcmd's sources and user guide but have not been run.
- **Paths with characters outside ASCII** have not been tested with MEGAcmd's Windows client.
- **Transfer counts include all of MEGAcmd's transfers**, those of its other syncs too.
- **MEGA-Route cannot see MEGA's desktop app's syncs**; see above.
- Exclusions written to `.megaignore` apply to MEGA's engine only from when it reads the file; a file already synced
  before it was excluded stays on MEGA (MEGA does not delete it).
