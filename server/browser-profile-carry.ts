// A bot that turns on a shared browser profile nobody has used yet brings its own sign-ins into it: its kept Chrome profile
// and the restore file agent-browser autosaves, so the profile starts with what the bot already had and every bot on it gets
// those. The bot keeps its own copy. A profile with any browser data is never written to.
import { randomBytes } from "node:crypto";
import { chmodSync, constants, copyFileSync, cpSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { browserProfileDirectory, browserRestoreKey, isTemporaryBrowserSession } from "./browser-engine.ts";

/** Chrome's profile locks and DevTools port name the Chrome that wrote them; a copy carrying them would not start. */
const RUNNING_CHROME_FILES = new Set(["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"]);

export interface BrowserProfileCarryOptions {
  /** agent-browser's saved-state dir, `browserSessionsDirectory(env)`. */
  sessionsDirectory: string;
  dataDir?: string;
}

/** A session's restore files, newest first: the current name, then the one older releases wrote. */
function savedStateFiles(session: string, sessionsDirectory: string): string[] {
  const modified = (path: string) => { try { return statSync(path).mtimeMs; } catch { return 0; } };
  return [`${browserRestoreKey(session)}-${session}`, `${session}-${session}`]
    .flatMap((base) => [".json.enc", ".json"].map((suffix) => join(sessionsDirectory, base + suffix)))
    .filter(existsSync).sort((a, b) => modified(b) - modified(a));
}

/** True when `to` has never been used (no Chrome data, no saved state) and `from` has something to carry. */
export function browserProfileCarryable(from: string, to: string, options: BrowserProfileCarryOptions): boolean {
  const dataDir = options.dataDir ?? DATA_DIR;
  if (from === to || isTemporaryBrowserSession(from, dataDir) || isTemporaryBrowserSession(to, dataDir)) return false;
  if (existsSync(join(browserProfileDirectory(to, dataDir), "Default")) || savedStateFiles(to, options.sessionsDirectory).length) return false;
  return existsSync(browserProfileDirectory(from, dataDir)) || savedStateFiles(from, options.sessionsDirectory).length > 0;
}

/** Copies `from`'s browser data into the unused `to`; true once copied. Both browsers must be closed first. */
export function carryBrowserProfile(from: string, to: string, options: BrowserProfileCarryOptions): boolean {
  if (!browserProfileCarryable(from, to, options)) return false;
  const dataDir = options.dataDir ?? DATA_DIR;
  const source = browserProfileDirectory(from, dataDir);
  if (existsSync(source)) {
    const target = browserProfileDirectory(to, dataDir);
    // Copied beside the target and renamed in, so a failed copy never leaves a half profile that later reads as used.
    const staging = `${target}.carry-${randomBytes(6).toString("hex")}`;
    try {
      cpSync(source, staging, { recursive: true, verbatimSymlinks: true, filter: (path) => !RUNNING_CHROME_FILES.has(basename(path)) });
      // Only an empty start: browserProfileCarryable found no Chrome data in it.
      rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      renameSync(staging, target);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  const state = savedStateFiles(from, options.sessionsDirectory)[0];
  if (state) {
    const copy = join(options.sessionsDirectory, `${browserRestoreKey(to)}-${to}${state.endsWith(".enc") ? ".json.enc" : ".json"}`);
    copyFileSync(state, copy, constants.COPYFILE_EXCL);
    chmodSync(copy, 0o600);
  }
  return true;
}
