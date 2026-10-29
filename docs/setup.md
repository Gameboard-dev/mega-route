# Setting up MEGAcmd

[← README](../README.md)

MEGA-Route does its work through [MEGAcmd](https://mega.io/cmd), MEGA's official command-line program. This page covers
installing it, its background server, signing in, and how the plugin finds it.

- [Install MEGAcmd](#install-megacmd)
- [MEGAcmd's server](#megacmds-server)
- [Sign in](#sign-in)
- [How the plugin finds MEGAcmd](#how-the-plugin-finds-megacmd)
- [Signing out](#signing-out)
- [Other MEGAcmd commands](#other-megacmd-commands)

## Install MEGAcmd

Download MEGAcmd for your system from MEGA's page, [mega.io/cmd](https://mega.io/cmd), and install it. The plugin never
downloads or installs it for you.

| System | Where it goes | The program MEGA-Route runs |
|---|---|---|
| Windows | `%LOCALAPPDATA%\MEGAcmd` (for example `C:\Users\you\AppData\Local\MEGAcmd`) | `MegaClient.exe` |
| macOS | `/Applications/MEGAcmd.app` | `Contents/MacOS/mega-exec` |
| Linux | the package installs to `/usr/bin` | `/usr/bin/mega-exec` |

MEGAcmd's `mega-*.bat` (Windows) and `mega-*` (macOS, Linux) commands are small wrappers around that one client
program. The plugin runs the client directly: Obsidian (Node) cannot run `.bat` files without a shell, and the plugin
never uses a shell.

Then open Settings → MEGA-Route. Under **MEGAcmd**, the **Program** row should say *Found* with MEGAcmd's version.

## MEGAcmd's server

MEGAcmd runs a **background server** (`MEGAcmdServer.exe` on Windows, `mega-cmd-server` on Linux) that holds your session
and runs the syncs. Its commands pass through to the server, and **its client starts the server whenever it is not
running**. Syncs run only while the server runs.

- **Start MEGAcmd** (settings, ribbon menu or status bar menu) asks MEGAcmd for its version, which starts the server.
- **Stop MEGAcmd…** sends MEGAcmd's `quit` command, after you confirm. Every sync MEGAcmd runs stops until the server is
  started again; MEGA's engine then picks up where it stopped.
- **Start MEGAcmd with Obsidian** (a setting for this device, off by default) starts the server when Obsidian starts, if
  it is not running.

The server **keeps running after Obsidian closes**, and keeps syncing: the sync does not need Obsidian. It stops when
you stop it, sign out of your computer or restart it. MEGAcmd's user guide does not describe starting the server when
you sign in to your computer; to have the sync run whenever Obsidian is open, turn on *Start MEGAcmd with Obsidian*, or
start MEGAcmd yourself (for example from its Start-menu entry).

While the server is stopped, the plugin's status checks ask MEGAcmd nothing, so they never start it: they only look at
the list of running programs.

## Sign in

MEGAcmd must be signed in to your MEGA account. Sign in from the plugin's settings, once:

1. Start MEGAcmd (**Server** → **Start MEGAcmd**). If MEGAcmd still holds a session from before, the **Account** row now
   says *Signed in*, and you are done.
2. Under **Sign in to MEGA**, type your MEGA email and password. If your account has two-factor authentication, you may
   also type the current code from your authenticator app in **One-time code** (optional; leave it empty otherwise).
   Press **Sign in** (or Enter).
3. Two-factor authentication:
   - **Code typed in advance**: when MEGAcmd asks for the code, the plugin gives it at once. If the account has no
     two-factor authentication, the code is simply not used.
   - **Field left empty**: when MEGAcmd asks, the same **One-time code** field is highlighted with "Enter the code from
     your authenticator app"; type it and press **Send code** (or Enter). **Cancel** stops the sign-in.
   - **A code not accepted** (wrong, or expired while you typed it: MEGA does not tell them apart): the field asks for
     the next code, and the sign-in is tried again **without your password being typed again**, up to three codes in
     all. The password is held only by that one sign-in, then dropped.
   - The code is always written to MEGAcmd's input when MEGAcmd asks for it, never put on a command line, and the field
     is emptied after every attempt. (MEGAcmd's `--auth-code=` option would put it on the command line; it is not used.)

The **Account** row then shows *Signed in as y\*\*\*@e\*\*\*.com*. Signing in loads your account's file tree, which can
take a minute for a large account.

The sign-in controls are greyed out, with the reason on hover and under them, while MEGAcmd is not installed or its
server is not running. The plugin does not start MEGAcmd to sign in: started, it may turn out to be signed in already.

### MEGAcmd keeps the session, so the password is needed once

From MEGAcmd's user guide and its source (read 2026-10-29):

- On a successful sign-in, MEGAcmd saves its **session** (not your password) to a file named `session` in its
  `.megaCmd` folder: `%LOCALAPPDATA%\MEGAcmd\.megaCmd\session` on Windows, `~/.megaCmd/session` on macOS and Linux
  (`ConfigurationManager::saveSession`; on macOS and Linux MEGAcmd makes the file readable by you only, on Windows it
  is protected by your Windows account's folder permissions).
- **Whenever MEGAcmd's server starts** (after a restart of the server, of Obsidian or of the computer), it signs in
  again with that saved session by itself, and resumes its syncs ("The session will be resumed when the service is
  restarted").
- The session lasts "until you log out of it or kill it from another client" (MEGAcmd's user guide): MEGAcmd's
  `logout`, ending the session from MEGA's web app or another MEGA app (they list your sessions and can close them), or
  with MEGAcmd's `killsession`, deleting MEGAcmd's `.megaCmd` folder (for example by uninstalling MEGAcmd), or MEGA blocking
  the account. Neither the guide nor the source mentions an expiry by time.

So **the plugin never stores your password**. It is used once, to sign in. If MEGAcmd's session ends, the plugin says
so once, in a notice ("MEGA-Route is signed out of MEGA, so nothing syncs. Sign in again in its settings"), and shows
the sign-in form; nothing syncs until you sign in again, and the plugin never retries by itself.

To end MEGAcmd's session yourself: **Sign out of MEGA** in the settings ([Signing out](#signing-out)), or end the
session from MEGA's web app.

### What happens to your password

- The plugin passes your email and password to MEGAcmd on this computer, by running MEGAcmd's client
  (`MegaClient.exe` / `mega-exec`) as `login <email> <password>`, started directly with an argument array (no shell, no
  window). MEGAcmd signs in with MEGA and keeps its own session (above).
- The plugin does **not** store them anywhere: not in `data.json`, not in Obsidian's local storage or keychain, not on
  disk, not in its log. The password field is emptied the moment you press **Sign in**, the email and code fields when
  the attempt ends. Messages and log lines never show the password or code, and show the address only masked.
- The **two-factor code** is not put on a command line: MEGAcmd asks for it, and the plugin writes it to MEGAcmd's
  input.
- **Why the password is a command-line argument.** MEGAcmd's scriptable client accepts `login <email>` without the
  password only in MEGAcmd's interactive shell (`Extra args required in non-interactive mode`), and that shell reads the
  password from a console window, which a plugin cannot drive without opening one. So the password is an argument of
  `MegaClient.exe` for the few seconds the sign-in takes (up to the time you take to type a two-factor code). During
  that time, programs running as your Windows user (and administrators) could read it from the process list, as they
  could read anything else of yours; other users of the computer cannot. MEGAcmd's client passes it on to MEGAcmd's
  server over a local named pipe.
- **MEGAcmd's own log**: MEGAcmd writes sign-in commands to its server log as `login <REDACTED>`. Two exceptions: if
  MEGAcmd's server was started with the environment variable `MEGACMD_DO_NOT_REDACT_LINES` set, it writes them in full
  (the plugin never passes that variable to MEGAcmd; check it is not set in your environment if you start MEGAcmd
  yourself); and at MEGAcmd's `verbose` log level it writes the two-factor code (useless a minute later). The plugin's
  log pane hides both, and every email address, whatever MEGAcmd writes.
- A password holding a quotation mark (`"`), starting with `-`, or starting with `'` with no space in it cannot be
  passed through MEGAcmd's client unchanged (its server would read it differently), so the plugin refuses it and says
  so. Sign in once in MEGAcmd itself instead: open MEGAcmd from your Start menu (or `mega-cmd` in a terminal on macOS and
  Linux), type `login you@example.com`, and type the password when it asks. Then press Refresh in the settings.

### When MEGA asks for more than a password

MEGAcmd's `login` asks one question only: the two-factor code ("Enter the code generated by your authentication app"),
handled above. Other checks MEGA may make are not questions MEGAcmd can answer, and the plugin says what to do:

| MEGAcmd answers | What it means | What to do |
|---|---|---|
| Account blocked … verify your email | MEGA suspended the account for your safety (for example a sign-in from a new place) until you confirm by email. | Follow the steps in MEGA's email, then sign in again. |
| Account blocked … verify your phone number | MEGA suspended the account until a phone number is verified. | Verify it on mega.nz (MEGA's message may give a link), then sign in again. |
| Login failed: unconfirmed account | The account's confirmation email was never opened. | Open it, then sign in again. |
| Too many requests | MEGA refuses sign-ins for a while. | Wait, then try again. |

## How the plugin finds MEGAcmd

It looks in the usual place for your system (the table above), and looks again each time you open its settings, so a
MEGAcmd installed while Obsidian is open is found without a restart. If you installed MEGAcmd elsewhere, set **MEGAcmd's
folder (this device)** to MEGAcmd's folder, or to its client program (`MegaClient.exe` on Windows, `mega-exec` on macOS
and Linux), and press **Check**. The path must:

- be absolute, and lead to MEGAcmd's client (no other program is accepted);
- point to an existing file **outside the vault**.

This setting is kept **on this device only** (Obsidian's local storage for the vault), never in the vault's `data.json`,
so another device that syncs the vault can never change which program this one runs.

MEGAcmd's server log is looked for beside it: `.megaCmd\megacmdserver.log` in MEGAcmd's folder on Windows,
`~/.megaCmd/megacmdserver.log` on macOS and Linux.

## Signing out

Settings → MEGA-Route → **Sign out of MEGA** → **Sign out…** (enabled only while MEGAcmd is signed in). A dialog says
what will happen; on **Sign out**, the section shows each step as it runs, with a spinner ("Signing out: step 2 of 3,
stopping other transfers…"), the status bar says `signing out 2/3`, and every other MEGA action (signing in, creating,
pausing, resuming, starting or stopping MEGAcmd) is refused until it ends. The steps, each checked before the next:

1. **Pause the sync** of this vault (`sync -p`). The sync's own transfers stop with it; an upload that had not finished
   is not created on MEGA (MEGA adds a file only once its upload completes), and nothing in the vault is changed.
2. **Stop any other transfer.** `transfers` lists the transfers that are not a sync's; usually there is none and the
   plugin goes on at once. Otherwise `transfers -c -a` cancels them (MEGA's engine cancels only transfers that are not
   a sync's: "Marked all non-sync non-streaming transfers as cancelled", MEGA SDK), and the list is checked every
   quarter second for up to 5 seconds; if one is still live, the sign-out stops here: the sync is paused and MEGAcmd is
   still signed in. (Version 3.0.6 waited instead for MEGAcmd's whole queue, the paused sync's transfers included, to
   empty, which never happened: it gave up after 15 seconds.)
3. **Sign MEGAcmd out** (`logout`). MEGA ends the session, and MEGAcmd deletes its saved session and its local cache,
   **its sync configuration included** (MEGAcmd's user guide: "Syncs, backups, and webdavs are specific to a session,
   so logging out will cause them to be cancelled"). The files and folders on both sides are not touched. MEGAcmd
   sets `logout`'s exit code from MEGA's answer, so that is the check; the next status check asks MEGAcmd as usual.
   The plugin never uses `logout --keep-session`: that keeps the session on this computer for the next start (so it is
   not a full sign-out) and prints the session's secret id.

The result stays in the section: *Signed out of MEGA*, or *Sign-out stopped at step N … State: …* (what is paused, and
whether MEGAcmd is still signed in). Afterwards the status bar says *not signed in*, the sign-in form is active, and
nothing syncs. The plugin never signs in again by itself. To sync again: sign in (your password, and the one-time code
if two-factor authentication is on), then **Check and create…** sets the sync up again; MEGA's engine compares both
sides afresh, as on a first sync.

**If Obsidian closes or reloads during a sign-out**, the plugin finds out at its next start, from MEGAcmd's real state,
how far it got, and says so in the section: *The last sign-out did not finish: MEGAcmd is still signed in and the sync
is paused. Sign out again, or resume the sync.* (or that it had finished).

**How long it takes.** In the usual case the plugin asks MEGAcmd three things (`sync -p`, `transfers`, `logout`),
after one look at the list of running programs. Each call to MEGAcmd starts its client program, which connects to
MEGAcmd's server: a few tenths of a second each on a typical PC. `logout` waits for MEGA to end the session (about a
second). Signing in is mostly MEGA's own time: checking the password, then loading the account's file list (about 6 s
for an account of some 14,000 files, in MEGAcmd's log); the plugin adds one look at the program list and, afterwards,
one listing of the syncs. Each sign-in's and sign-out's times are written to the plugin's log.

## Other MEGAcmd commands

Everything else MEGAcmd offers (transfers, sync issues, exclusions, log levels) can be used in MEGAcmd directly; see
MEGAcmd's [user guide](https://github.com/meganz/MEGAcmd/blob/master/UserGuide.md). The plugin shows what MEGAcmd
reports, so changes made there appear in the plugin at its next check.
