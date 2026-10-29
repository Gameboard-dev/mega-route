// Where MEGAcmd is on this computer, and the check on a path the user sets for it.
//
// MEGAcmd's scriptable commands are thin wrappers around one client program, which passes the command to MEGAcmd's
// background server (and starts that server when it is not running):
//   Windows  %LOCALAPPDATA%\MEGAcmd\MegaClient.exe (the mega-*.bat files run `"%~dp0MegaClient.exe" <command> %*`;
//            Node cannot run .bat files without a shell, so the plugin runs MegaClient.exe directly)
//   macOS    /Applications/MEGAcmd.app/Contents/MacOS/mega-exec
//   Linux    /usr/bin/mega-exec
// The server writes its log to `.megaCmd/megacmdserver.log`: beside the server program on Windows, in the home folder
// on macOS and Linux (MEGAcmd src/megacmdcommonutils.cpp, src/megacmdlogger.cpp).

export interface Platform {
  os: "windows" | "macos" | "linux";
  /** Environment variables (LOCALAPPDATA, HOME, SystemRoot). */
  env: Record<string, string | undefined>;
  /** The user's home folder. */
  home: string;
}

export interface MegaCmdPaths {
  /** The client program the plugin runs. */
  client: string;
  /** MEGAcmd's server log. */
  log: string;
}

function join(os: Platform["os"], ...parts: string[]): string {
  const sep = os === "windows" ? "\\" : "/";
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter((p) => p !== "")
    .join(sep);
}

function dirname(os: Platform["os"], p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : os === "windows" ? p : "/";
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** The client program's file name on each system (the only names the plugin will run). */
export function clientNames(os: Platform["os"]): string[] {
  return os === "windows" ? ["megaclient.exe"] : ["mega-exec"];
}

/** Where MEGAcmd's installer puts it, or null when that cannot be worked out (no LOCALAPPDATA). */
export function defaultClient(p: Platform): string | null {
  if (p.os === "windows") {
    const base = p.env.LOCALAPPDATA;
    return base ? join("windows", base, "MEGAcmd", "MegaClient.exe") : null;
  }
  if (p.os === "macos") return "/Applications/MEGAcmd.app/Contents/MacOS/mega-exec";
  return "/usr/bin/mega-exec";
}

/** The log path that goes with a client program. */
export function pathsFor(p: Platform, client: string): MegaCmdPaths {
  if (p.os === "windows") {
    const dir = dirname("windows", client);
    return { client, log: join("windows", dir, ".megaCmd", "megacmdserver.log") };
  }
  return { client, log: join(p.os, p.home, ".megaCmd", "megacmdserver.log") };
}

/** Names of MEGAcmd's server process, and of the MEGA desktop app, as the process list shows them. */
export function serverProcessNames(os: Platform["os"]): string[] {
  return os === "windows" ? ["megacmdserver.exe"] : ["mega-cmd-server", "megacmdserver", "megacmdloader"];
}
export function desktopAppProcessNames(os: Platform["os"]): string[] {
  return os === "windows" ? ["megasync.exe"] : ["megasync"];
}

/** The program that lists processes: tasklist (Windows, from SystemRoot) or ps. */
export function processLister(p: Platform): { program: string; args: string[] } | null {
  if (p.os === "windows") {
    const root = p.env.SystemRoot || p.env.windir || p.env.WINDIR;
    if (!root || !/^[A-Za-z]:\\/.test(root)) return null;
    // Only programs whose name starts with MEGA (MEGAcmdServer.exe, MEGAsync.exe): about 0.2 s, against 0.6 s for all.
    return { program: join("windows", root, "System32", "tasklist.exe"), args: ["/FI", "IMAGENAME eq MEGA*", "/FO", "CSV", "/NH"] };
  }
  return { program: "/bin/ps", args: ["-A", "-o", "comm="] };
}

export type ClientCheck = { ok: true; path: string } | { ok: false; reason: string };

/**
 * A client path (from detection or the per-device setting) before the plugin runs it: an absolute path to an existing
 * file named as MEGAcmd's client, outside the vault (a program inside the vault could have come from another device).
 */
export async function checkClientPath(
  p: Platform,
  input: string,
  vaultPath: string,
  stat: (path: string) => Promise<{ isFile(): boolean; isDirectory?(): boolean }>,
): Promise<ClientCheck> {
  let path = input.trim();
  if (!path) return { ok: false, reason: "No path is set for MEGAcmd." };
  if (/[\u0000-\u001f"]/.test(path)) return { ok: false, reason: "The path contains a control character or a quotation mark." };
  const absolute = p.os === "windows" ? /^[A-Za-z]:\\/.test(path) : path.startsWith("/");
  if (!absolute) return { ok: false, reason: `Not an absolute path: ${path}` };
  // MEGAcmd's folder may be given instead of its client program: the client's name is added.
  try {
    const st = await stat(path);
    if (st.isDirectory?.()) {
      if (p.os === "windows") path = join(p.os, path, "MegaClient.exe");
      else if (p.os === "macos" && /\.app\/?$/.test(path)) path = join(p.os, path, "Contents", "MacOS", "mega-exec");
      else path = join(p.os, path, "mega-exec");
    }
  } catch {
    // checked below
  }
  const name = basename(path);
  const allowed = clientNames(p.os);
  if (!allowed.includes(p.os === "windows" ? name.toLowerCase() : name)) {
    return { ok: false, reason: `The file must be MEGAcmd's client program (${p.os === "windows" ? "MegaClient.exe" : "mega-exec"}), not ${name}.` };
  }
  const lower = (s: string) => (p.os === "windows" ? s.toLowerCase().replace(/\//g, "\\") : s);
  const v = lower(vaultPath).replace(/[\\/]+$/, "");
  if (v && (lower(path) + (p.os === "windows" ? "\\" : "/")).startsWith(v + (p.os === "windows" ? "\\" : "/"))) {
    return { ok: false, reason: "MEGAcmd must not be run from inside the vault." };
  }
  try {
    const st = await stat(path);
    if (!st.isFile()) return { ok: false, reason: `Not a file: ${path}` };
  } catch {
    return { ok: false, reason: `Not found: ${path}` };
  }
  return { ok: true, path };
}
