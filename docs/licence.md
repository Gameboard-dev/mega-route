# Licence

[← README](../README.md)

## MEGA-Route

MEGA-Route is released under the **MIT licence**; see [LICENSE](../LICENSE). Version 3 is a new implementation: it
contains no code of the MEGA Sync plugin it started from (see the README's credits) or of MEGA-Route 2.x, which are not
part of this repository.

`main.js` bundles only the plugin's own code. Its build tools (esbuild, MIT; TypeScript, Apache-2.0) and Obsidian's type
definitions (MIT) are used to build it and are not shipped.

## MEGAcmd

MEGA-Route does not include, link to or distribute any part of MEGAcmd. It runs MEGAcmd, which you install separately
from MEGA, as a separate program. MEGAcmd's own licence
([LICENSE](https://github.com/meganz/MEGAcmd/blob/master/LICENSE)) is a BSD 2-clause licence by Mega Limited, except for
parts distributed under the GNU General Public License, among them the interactive shell (`MEGAcmdShell.exe` on
Windows), which the plugin does not use. Using MEGA's service is subject to MEGA's
[terms](https://mega.io/terms).

MEGA, MEGAcmd and MEGAsync are names of Mega Limited's products. MEGA-Route is not affiliated with, endorsed or
supported by Mega Limited.
