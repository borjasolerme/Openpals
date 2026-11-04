import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { saidNo } from "./computer-sharing.mjs";
import { autostartEntry, createOpenAtLogin, HIDDEN_ARG } from "./open-at-login.mjs";
import { createAllWindowsClosedQuit } from "./window-all-closed.mjs";

const ORIGIN = "https://omb-u-fixture.fly.dev";
test("lending on opens the app at login, out of sight; off removes only the login item this app added", async (t) => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "omb-login-item-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const fakeApp = (settings = { openAtLogin: false, wasOpenedAtLogin: false }) => ({
    isPackaged: true, settings,
    getLoginItemSettings(options) { calls.push(["get", options]); return { ...settings }; },
    setLoginItemSettings(next) { calls.push(["set", next]); Object.assign(settings, { openAtLogin: next.openAtLogin }); },
  });
  const mac = fakeApp();
  const login = createOpenAtLogin({ app: mac, file: path.join(dir, "mac.json"), platform: "darwin", home: dir });
  login.follow(true);
  assert.equal(mac.settings.openAtLogin, true);
  mac.settings.wasOpenedAtLogin = true;
  assert.equal(login.startedHidden(), true, "a launch from the login item lending added starts hidden");
  login.follow(false);
  assert.equal(mac.settings.openAtLogin, false);
  const theirs = fakeApp({ openAtLogin: true, wasOpenedAtLogin: true });
  const kept = createOpenAtLogin({ app: theirs, file: path.join(dir, "theirs.json"), platform: "darwin", home: dir });
  kept.follow(true);
  kept.follow(false);
  assert.equal(theirs.settings.openAtLogin, true, "a login item the person set up is theirs");
  assert.equal(kept.startedHidden(), false, "and it opens the window as before");
  const windows = fakeApp();
  const win = createOpenAtLogin({ app: windows, file: path.join(dir, "win.json"), platform: "win32", home: dir, argv: ["OpenMausBot.exe", HIDDEN_ARG] });
  win.follow(true);
  assert.deepEqual(calls.filter(([kind]) => kind === "set").at(-1), ["set", { openAtLogin: true, args: [HIDDEN_ARG] }]);
  assert.equal(win.startedHidden(), true);
  assert.equal(createOpenAtLogin({ app: windows, file: path.join(dir, "win.json"), platform: "win32", home: dir, argv: ["OpenMausBot.exe"] }).startedHidden(), false);
  const config = path.join(dir, "config");
  const linux = createOpenAtLogin({ app: fakeApp(), file: path.join(dir, "linux.json"), platform: "linux", home: dir, env: { XDG_CONFIG_HOME: config, APPIMAGE: "/home/me/Apps/Open Maus$Bot.AppImage" } });
  linux.follow(true);
  const entry = path.join(config, "autostart", "openmausbot.desktop");
  assert.equal(await readFile(entry, "utf8"), autostartEntry("/home/me/Apps/Open Maus$Bot.AppImage"));
  assert.match(await readFile(entry, "utf8"), /^Exec="\/home\/me\/Apps\/Open Maus\\\$Bot\.AppImage" --omb-hidden$/m);
  linux.follow(false);
  await assert.rejects(readFile(entry, "utf8"), { code: "ENOENT" });
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, "[Desktop Entry]\nExec=openmausbot\n");
  linux.follow(true);
  linux.follow(false);
  assert.equal(await readFile(entry, "utf8"), "[Desktop Entry]\nExec=openmausbot\n", "an autostart entry the person wrote is never replaced or removed");
  const unpackaged = { ...fakeApp(), isPackaged: false };
  createOpenAtLogin({ app: unpackaged, file: path.join(dir, "dev.json"), platform: "darwin", home: dir }).follow(true);
  assert.equal(unpackaged.settings.openAtLogin, false, "a development build never registers itself");
});

test("an app started hidden at login runs with no window until the person opens one, then quits on its last close as before", () => {
  const listeners = new Map();
  const app = { on: (event, listener) => listeners.set(event, listener), quit: () => app.quits++, quits: 0 };
  const windows = [];
  let hidden = true;
  const quit = createAllWindowsClosedQuit({ app, platform: "linux", allWindows: () => windows, stayOpen: () => hidden });
  quit.settleStartup();
  assert.equal(app.quits, 0, "no window at all, and still running for lending");
  hidden = false;
  windows.push({});
  windows.length = 0;
  listeners.get("window-all-closed")();
  assert.equal(app.quits, 1);
});

test("who starts Paused, record by record: only someone who had said no to lending a Cloud of their own", () => {
  const cloud = { accountId: "acct_1", origin: ORIGIN };
  const cases = [
    ["nothing kept", undefined, false],
    ["lending on, internet connection included", { enabled: true, cloud, internet: true }, false],
    ["lending on, kept from before the internet connection could be chosen", { enabled: true, cloud }, false],
    ["lending on, internet connection unticked", { enabled: true, cloud, internet: false }, true],
    ["turned off by the person", { enabled: false, cloud, internet: true, stopped: { reason: "you", at: 1 } }, true],
    ["off, saved before the reason was kept", { enabled: false, cloud, folders: [], internet: true }, true],
    ["stopped at a sign-out", { enabled: false, cloud, folders: [], internet: true, stopped: { reason: "signed-out", at: 1 } }, false],
    ["stopped when another account signed in", { enabled: false, cloud, folders: [], internet: true, stopped: { reason: "account-changed", at: 1 } }, false],
    ["stopped when My Cloud moved to a new machine", { enabled: false, cloud, folders: [], internet: true, stopped: { reason: "machine-changed", at: 1 } }, false],
    ["Computer access lending to a server", { enabled: true, sessionId: randomUUID(), environmentId: randomUUID() }, false],
    ["Computer access turned off by the person", { enabled: false, stopped: { reason: "you", at: 1 } }, false],
  ];
  for (const [what, record, paused] of cases) assert.equal(saidNo(record), paused, what);
});
