# The sync

[← README](../README.md)

- [What the sync is](#what-the-sync-is)
- [Creating it](#creating-it)
- [Pausing, resuming, removing](#pausing-resuming-removing)
- [Exclusions and .megaignore](#exclusions-and-megaignore)
- [Deleted files](#deleted-files)
- [More than one computer](#more-than-one-computer)

## What the sync is

One MEGAcmd sync between this vault's folder and one MEGA folder. It is **two-way**: additions, changes, renames and
deletions on either side are made on the other, by MEGA's sync engine (the same engine MEGA's desktop app uses). It runs
in MEGAcmd's background server, continuously, whether or not Obsidian is open, until it is paused or removed or the
server stops.

The plugin finds "its" sync by the vault's folder: the MEGAcmd sync whose local folder is this vault. MEGAcmd's other
syncs on the computer are listed in the settings but never touched.

## Creating it

1. Set **MEGA folder**: an absolute path in your Cloud Drive, such as `/RAG` or `/Notes/My vault`. The default is `/`
   followed by the vault's name. It cannot be the whole Cloud Drive (`/`), and cannot be in the Rubbish Bin (`//bin`),
   the Vault of backups (`//in`) or an incoming share; a name cannot start with `-` or contain `"`.
2. Press **Check and create…**. The plugin checks, changing nothing:
   - MEGAcmd is found, its server runs, it is signed in;
   - MEGAcmd has no sync of this vault, of a folder containing it, or of a folder inside it (MEGA does not allow nested
     syncs);
   - no other MEGAcmd sync uses the MEGA folder, or a folder inside or around it;
   - the MEGA folder exists (if not, the dialog offers **Create /… on MEGA**, which runs `mkdir -p`), and what is at its
     top;
   - whether MEGA's desktop app is running (see [one sync engine per folder](troubleshooting.md#one-sync-engine-per-folder));
   - which exclusion patterns can be written as MEGA rules.
3. The dialog lists anything **blocking** (the sync cannot be created until it is fixed) and anything **to note**:
   - a **MEGA folder that is not empty** is merged with the vault: files only on MEGA are downloaded into the vault,
     files only in the vault are uploaded, and a file that differs on both sides with no earlier sync state may be
     reported as a [sync issue](troubleshooting.md#sync-issues) for you to settle. If the folder holds old copies you do
     not want back in the vault, clean it up first, or choose a new, empty folder.
   - files left by MEGA-Route 2.x (`_mega_sync_snapshot.json`, `.mega-sync-bin`, `.mega-sync-conflicts`) are named; the
     fixed exclusions keep them out of the vault.
4. **Create the sync** writes the exclusions to `.megaignore` first, so they apply from the first scan, then runs
   MEGAcmd's `sync <vault folder> <MEGA folder>`. The status bar shows `MEGA: starting`, then `syncing`, then `synced`.

The first sync of a large vault takes time: MEGA's engine scans both sides, then transfers. The status bar's counts and
percentage come from MEGAcmd's transfer summary.

## Pausing, resuming, removing

From the ribbon or status bar menu, the settings (**The sync**), or the commands *Pause the sync* and *Resume the sync*:

- **Pause** (`sync -p`): MEGAcmd stops the sync but keeps its configuration and state. Changes made meanwhile are synced
  on **Resume** (`sync -e`).
- **Remove…** (`sync -d`), after you confirm: MEGAcmd forgets the sync. **No file is deleted**, in the vault or on MEGA.
  Creating the sync again later compares both sides afresh, as on the first run.

Changing **MEGA folder** after the sync exists does not move the sync; remove it and create it again for another folder.

## Exclusions and .megaignore

MEGA's sync engine reads exclusion rules from a file named `.megaignore` at the top of the synced folder
([MEGA's help page](https://help.mega.io/installs-apps/desktop/megaignore)). The plugin writes your exclusions there, as
MEGA rules, inside a block of its own:

```
-:Thumbs.db
-:.*
… your own lines, and those MEGA wrote, are kept as they are …

# BEGIN MEGA-Route (written by the Obsidian plugin MEGA-Route: change these rules in its settings, not here)
+dN:.obsidian
-p:.git
-p:node_modules
-p:.obsidian/workspace*
-p:.obsidian/plugins/mega-route
-p:.obsidian/plugins/mega-sync-fork
-p:.trash
-fN:_mega_sync_snapshot.json
-N:.mega-sync-bin
-N:.mega-sync-conflicts
# END MEGA-Route
```

**How MEGA reads it**: the **last** rule that matches a path decides. The block is always at the end of the file, so its
rules override the lines above; and the fixed rules are the last lines of the block, so nothing brings their paths back.
If the vault has no `.megaignore` yet, the plugin writes MEGA's own default rules above the block, as MEGA would.

**Your patterns** (*Leave out* and *Sync even so* in the settings) are relative to the top of the vault, one per line;
lines starting with `#` are ignored. In them `*` stands for any characters within one file or folder name, `**` for
any characters across folders, and `?` for one character. Each pattern is written as the MEGA rule that matches exactly
what it says:

| Pattern | MEGA rule | Leaves out |
|---|---|---|
| `folder/**` or `folder/` | `-p:folder` | the folder and everything in it |
| `Drafts/old.md` | `-p:Drafts/old.md` | that file (or folder) |
| `**/name` | `-n:name` | anything called `name`, in any folder |
| `LaTeX/compiled/*.log` | `-pr:LaTeX/compiled/[^/]*[.]log` | `.log` files directly in `LaTeX/compiled` |
| `a/*/b` | `-pr:a/[^/]*/b` | `b` in any folder directly inside `a` |
| `a/**/b.md` | `-pr:a/(.*/)?b[.]md` | `b.md` anywhere under `a` |

Why the `-pr:` rules: MEGA's own `*` in a path rule also matches `/` (the MEGA SDK's `wildcardMatch`, used for glob
rules, treats `*` as any characters), so `-p:LaTeX/compiled/*.log` would also leave out `.log` files in folders under
`compiled`. A `-pr:` rule is a regular expression (POSIX extended) that MEGA matches against the whole path, so
`[^/]*` keeps `*` within one name, exactly as you wrote it; special characters are written in brackets (`[.]`), so no
backslashes are needed. MEGA ignores letter case in all these rules, as in its own defaults.

A pattern that would leave out the whole vault (`*`, `**`, `**/*`) or Obsidian's settings folder (`.obsidian`: use the
switch below instead) is not written, nor one with a control character or longer than 512 characters; the settings list
such patterns under the preview, in red. Every other pattern is written without comment.

**The fixed rules** always apply: Obsidian's window layout (`.obsidian/workspace*`, different on each device), the
plugin's own folder (per-device files and 2.x's caches), Obsidian's `.trash`, and 2.x's leftovers.

**Obsidian's settings folder**: MEGA's default rule `-:.*` leaves out every name starting with a dot, `.obsidian`
included. *Sync Obsidian's settings folder* (on by default) adds `+dN:.obsidian`, which brings that folder back (other
dot-names stay out).

**When it is written**: when the sync is created; when you change these settings while the sync exists (1.5 s after the
last change); and when you press **Write to .megaignore now**. It is written only when its text would change.

**Shared with MEGA's desktop app**: the desktop app reads the same `.megaignore` if it syncs or backs up this folder, so
the block applies there too. By default MEGA does not sync `.megaignore` itself to other computers (`-sync:.megaignore`
is MEGA's default), so each computer keeps its own; the plugin writes it on each computer where it runs.

Rules you add by hand outside the block stay in force. A line that is not a valid MEGA rule stops ("stalls") the sync of
that folder: check `.megaignore` if a sync issue mentions it.

## Deleted files

MEGA's engine keeps deleted files for a while:

- a file deleted **in the vault** goes to MEGA's **Rubbish Bin**, in a `SyncDebris` folder (restore it in MEGA's apps);
- a file deleted **on MEGA** is moved, in the vault, into MEGA's local bin, a hidden folder at the vault's top
  (MEGAcmd's user guide calls it `Rubbish/.debris`; current MEGA versions name it `.debris`), which MEGA leaves out of
  the sync.

MEGA also keeps earlier versions of changed files (file versioning, if on in your MEGA account).

## More than one computer

Create the sync on each computer, to the same MEGA folder: MEGA's engine passes changes between them through MEGA.
Each computer needs MEGAcmd (or MEGA's desktop app, but never both on the same folder), signed in to the same account.
The plugin's settings in `data.json` are shared through the vault; MEGAcmd's path and *Start MEGAcmd with Obsidian* are
set per computer.
