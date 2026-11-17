import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { browserProfileDirectory, browserRestoreKey, browserSessionId } from "./browser-engine.ts";
import { browserProfileCarryable, carryBrowserProfile } from "./browser-profile-carry.ts";

let dataDir: string;
let sessionsDirectory: string;
const own = "bot-scout";
const shared = "shared";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Also true for a symlink whose target is gone. */
function present(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

function ownProfile(): string {
  const dir = browserProfileDirectory(own, dataDir);
  write(join(dir, "Default", "Cookies"), "linkedin cookies");
  write(join(dir, "Local State"), "{}");
  write(join(dir, "DevToolsActivePort"), "9222\n/devtools/browser/x");
  symlinkSync("host-123", join(dir, "SingletonLock"));
  symlinkSync("/tmp/nowhere/SingletonSocket", join(dir, "SingletonSocket"));
  write(join(dir, "SingletonCookie"), "1");
  return dir;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "omb-carry-"));
  sessionsDirectory = join(dataDir, "sessions");
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

describe("carrying a bot's browser into an unused shared profile", () => {
  it("copies the bot's profile and saved sign-ins, leaving Chrome's locks behind and the bot's own copy in place", () => {
    const source = ownProfile();
    write(join(sessionsDirectory, `${browserRestoreKey(own)}-${own}.json.enc`), "sealed state");

    expect(carryBrowserProfile(own, shared, { dataDir, sessionsDirectory })).toBe(true);

    const target = browserProfileDirectory(shared, dataDir);
    expect(readFileSync(join(target, "Default", "Cookies"), "utf8")).toBe("linkedin cookies");
    expect(readFileSync(join(target, "Local State"), "utf8")).toBe("{}");
    for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"]) {
      expect(present(join(target, lock)), lock).toBe(false);
    }
    const state = join(sessionsDirectory, `${browserRestoreKey(shared)}-${shared}.json.enc`);
    expect(readFileSync(state, "utf8")).toBe("sealed state");
    if (process.platform !== "win32") expect(statSync(state).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(source, "Default", "Cookies"), "utf8")).toBe("linkedin cookies");
    expect(lstatSync(join(source, "SingletonLock")).isSymbolicLink()).toBe(true);
    expect(readdirSync(dirname(target)).filter((name) => name.includes(".carry-"))).toEqual([]);
  });

  it("carries the saved sign-ins of an older release's restore file", () => {
    write(join(sessionsDirectory, `${own}-${own}.json`), "{\"cookies\":[],\"origins\":[]}");

    expect(carryBrowserProfile(own, shared, { dataDir, sessionsDirectory })).toBe(true);

    expect(existsSync(join(sessionsDirectory, `${browserRestoreKey(shared)}-${shared}.json`))).toBe(true);
    expect(existsSync(browserProfileDirectory(shared, dataDir))).toBe(false);
  });

  it("fills a profile folder Chrome never wrote to", () => {
    ownProfile();
    write(join(browserProfileDirectory(shared, dataDir), "First Run"), "");

    expect(carryBrowserProfile(own, shared, { dataDir, sessionsDirectory })).toBe(true);
    expect(existsSync(join(browserProfileDirectory(shared, dataDir), "Default", "Cookies"))).toBe(true);
  });

  it("never writes over a profile that already has browser data or saved sign-ins", () => {
    ownProfile();
    write(join(sessionsDirectory, `${browserRestoreKey(own)}-${own}.json.enc`), "bot state");
    const target = browserProfileDirectory(shared, dataDir);
    write(join(target, "Default", "Cookies"), "the profile's own cookies");

    expect(browserProfileCarryable(own, shared, { dataDir, sessionsDirectory })).toBe(false);
    expect(carryBrowserProfile(own, shared, { dataDir, sessionsDirectory })).toBe(false);
    expect(readFileSync(join(target, "Default", "Cookies"), "utf8")).toBe("the profile's own cookies");
    expect(existsSync(join(sessionsDirectory, `${browserRestoreKey(shared)}-${shared}.json.enc`))).toBe(false);

    rmSync(target, { recursive: true });
    write(join(sessionsDirectory, `${browserRestoreKey(shared)}-${shared}.json.enc`), "the profile's own state");
    expect(carryBrowserProfile(own, shared, { dataDir, sessionsDirectory })).toBe(false);
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(join(sessionsDirectory, `${browserRestoreKey(shared)}-${shared}.json.enc`), "utf8")).toBe("the profile's own state");
  });

  it("does nothing for a bot with no browser data yet, or a temporary browser", () => {
    expect(carryBrowserProfile(own, shared, { dataDir, sessionsDirectory })).toBe(false);

    ownProfile();
    const guest = browserSessionId("scout", "guest", dataDir);
    expect(carryBrowserProfile(own, guest, { dataDir, sessionsDirectory })).toBe(false);
    expect(carryBrowserProfile(guest, shared, { dataDir, sessionsDirectory })).toBe(false);
    expect(existsSync(browserProfileDirectory(guest, dataDir))).toBe(false);
    expect(existsSync(browserProfileDirectory(shared, dataDir))).toBe(false);
  });
});
