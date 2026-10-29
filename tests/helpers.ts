// Test helpers: a temporary folder with a fake MEGAcmd and a fake process list, and a controller wired to them.

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Controller } from "../src/core/controller.ts";
import type { ControllerEnv } from "../src/core/controller.ts";
import { ProcessRunner } from "../src/core/runner.ts";
import { writeInPlace } from "../src/core/fsio.ts";
import type { WriteFs } from "../src/core/fsio.ts";
import type { ChildProcessApi } from "../src/core/runner.ts";
import type { LogLevel } from "../src/core/log.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_CLIENT = path.join(here, "fake", "megaclient.cjs");
export const FAKE_PROCESSES = path.join(here, "fake", "processes.cjs");

export interface FakeState {
  loggedIn?: boolean;
  email?: string;
  version?: string;
  syncs?: { id: string; local: string; remote: string; runState?: string; status?: string; error?: string; size?: string; files?: number; dirs?: number }[];
  folders?: Record<string, string[]>;
  transfers?: Record<string, unknown>;
  issues?: { id: string; sync: string; reason: string }[];
  hang?: string;
  nextId?: string;
  logoutFails?: boolean;
  stuckTransfers?: boolean;
  account?: { email: string; password: string; mfa?: string; unconfirmed?: boolean; blocked?: string; tooMany?: boolean; slow?: number };
}

export interface Rig {
  dir: string;
  vault: string;
  controller: Controller;
  logs: { level: LogLevel; text: string }[];
  /** The argument arrays the fake MEGAcmd received, in order. */
  calls(): string[][];
  state(): FakeState;
  setState(s: FakeState): void;
  /** The text of .megaignore in the fake vault (null when absent). */
  ignore(): string | null;
  /** Order of events: "ignore-write" and each MEGAcmd command name. */
  events: string[];
  cleanup(): void;
}

export interface RigOptions {
  state?: FakeState;
  processes?: string[];
  processesFail?: boolean;
  /** The vault's folder name (inside the temporary folder). */
  vaultName?: string;
  /** No MEGAcmd client (not installed). */
  noClient?: boolean;
  /** An existing .megaignore in the vault. */
  ignore?: string;
}

export function rig(o: RigOptions = {}): Rig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mega-route-test-"));
  const vault = path.join(dir, o.vaultName ?? "My Vault");
  fs.mkdirSync(vault, { recursive: true });
  const statePath = path.join(dir, "state.json");
  const callsPath = path.join(dir, "calls.jsonl");
  fs.writeFileSync(statePath, JSON.stringify(o.state ?? { loggedIn: true, email: "someone@example.com", folders: { "/RAG": [] } }));
  if (o.ignore !== undefined) fs.writeFileSync(path.join(vault, ".megaignore"), o.ignore);
  // MEGACMD_DO_NOT_REDACT_LINES is set here on purpose: the runner must take it out before starting MEGAcmd.
  const env = { ...process.env, MEGACMD_DO_NOT_REDACT_LINES: "1", FAKE_MEGACMD_STATE: statePath, FAKE_MEGACMD_CALLS: callsPath, FAKE_PROCESSES: (o.processes ?? ["MEGAcmdServer.exe"]).join(","), FAKE_PROCESSES_OS: process.platform === "win32" ? "windows" : "posix", FAKE_PROCESSES_FAIL: o.processesFail ? "1" : "0" };
  const events: string[] = [];
  const logs: { level: LogLevel; text: string }[] = [];
  const nodeCp = cp as unknown as ChildProcessApi;
  const client = new ProcessRunner(nodeCp, process.execPath, [FAKE_CLIENT], env);
  const tracking = {
    program: client.program,
    run: (args: readonly string[], t: number) => {
      events.push(args[0]);
      return client.run(args, t);
    },
    runInteractive: (args: readonly string[], t: number, f: Parameters<NonNullable<ProcessRunner["runInteractive"]>>[2]) => {
      events.push(args[0]);
      return client.runInteractive(args, t, f);
    },
  };
  const ignorePath = path.join(vault, ".megaignore");
  const cenv: ControllerEnv = {
    windows: process.platform === "win32",
    vaultPath: vault,
    client: o.noClient ? null : tracking,
    clientPath: o.noClient ? null : "C:\\fake\\MegaClient.exe",
    clientProblem: o.noClient ? "Not found: C:\\Users\\x\\AppData\\Local\\MEGAcmd\\MegaClient.exe" : undefined,
    processes: new ProcessRunner(nodeCp, process.execPath, [FAKE_PROCESSES], env),
    serverNames: ["megacmdserver.exe"],
    desktopAppNames: ["megasync.exe"],
    readIgnore: async () => (fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, "utf8") : null),
    writeIgnore: async (t) => {
      events.push("ignore-write");
      // As the plugin writes it (in place: a hidden .megaignore cannot be replaced with writeFile on Windows).
      await writeInPlace(fs.promises as unknown as WriteFs, ignorePath, t);
    },
    log: (level, text) => logs.push({ level, text }),
  };
  return {
    dir,
    vault,
    controller: new Controller(cenv),
    logs,
    events,
    calls: () => (fs.existsSync(callsPath) ? fs.readFileSync(callsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]) : []),
    state: () => JSON.parse(fs.readFileSync(statePath, "utf8")) as FakeState,
    setState: (s) => fs.writeFileSync(statePath, JSON.stringify(s)),
    ignore: () => (fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, "utf8") : null),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

export const IGNORE_OPTIONS = {
  configDir: ".obsidian",
  pluginDir: ".obsidian/plugins/mega-route",
  excludePatterns: ".trash/**\nnode_modules/**\nLaTeX/compiled/*.aux",
  includePatterns: "",
  syncConfigFolder: true,
};
