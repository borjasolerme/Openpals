import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { autostartEntry, createOpenAtLogin, installOpenAtLogin } from "./open-at-login.mjs";

/** Electron's login item API on macOS: one item for the app. */
function fakeApp({ openAtLogin = false, isPackaged = true } = {}) {
  let on = openAtLogin;
  return {
    isPackaged,
    getLoginItemSettings: () => ({ openAtLogin: on }),
    setLoginItemSettings: (settings) => { on = settings.openAtLogin; },
  };
}

const temp = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), "omb-open-at-login-")); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };

test("macOS: the switch is the app's login item", async t => {
  const dir = await temp(t);
  const app = fakeApp();
  const login = createOpenAtLogin({ app, platform: "darwin", home: dir });
  assert.equal(login.chosen(), false);
  login.choose(true);
  assert.equal(login.chosen(), true);
  login.choose(false);
  assert.equal(app.getLoginItemSettings().openAtLogin, false);
});

/** Electron 43's login item API on Windows: one Run entry per name (the AppUserModelId unless named), `openAtLogin` true
 * only for that default entry with exactly the asked `args`, and `launchItems` listing every entry for this executable. */
function windowsApp(entries = []) {
  const items = new Map(entries.map(({ name, args = [], enabled = true }) => [name, { args, enabled }]));
  const DEFAULT = "electron.app.OpenMausBot";
  return {
    isPackaged: true, items,
    getLoginItemSettings({ args = [] } = {}) {
      const own = items.get(DEFAULT);
      return {
        openAtLogin: Boolean(own) && JSON.stringify(own.args) === JSON.stringify(args),
        launchItems: [...items].map(([name, item]) => ({ name, path: "C:\\OpenMausBot\\OpenMausBot.exe", args: item.args, scope: "user", enabled: item.enabled })),
      };
    },
    setLoginItemSettings({ openAtLogin: on, args = [], name = DEFAULT }) { if (on) items.set(name, { args, enabled: true }); else items.delete(name); },
  };
}

test("Windows: the person's entry has its own name and no arguments", async t => {
  const dir = await temp(t);
  const app = windowsApp();
  const login = createOpenAtLogin({ app, platform: "win32", home: dir });
  login.choose(true);
  assert.equal(login.chosen(), true);
  assert.deepEqual([...app.items], [["Openpals at login", { args: [], enabled: true }]]);
});

test("Windows: Settings shows on while any entry starts the app, and turning it off removes every one", async t => {
  const dir = await temp(t);
  const app = windowsApp([{ name: "electron.app.OpenMausBot", args: ["--omb-hidden"] }, { name: "Openpals at login" }]);
  const login = createOpenAtLogin({ app, platform: "win32", home: dir });
  const handlers = new Map();
  installOpenAtLogin({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, guard: (_channel, handler) => handler, loginItem: login, changed: () => {} });
  assert.deepEqual(await handlers.get("open-at-login:state")({}), { available: true, on: true });
  login.choose(false);
  assert.deepEqual([...app.items.keys()], []);
  const disabled = windowsApp([{ name: "Openpals at login", enabled: false }]);
  assert.equal(createOpenAtLogin({ app: disabled, platform: "win32", home: dir }).chosen(), false, "an entry turned off in Task Manager starts nothing");
});

test("Linux: the autostart entry starts the AppImage and opens the window", async t => {
  const dir = await temp(t);
  const config = path.join(dir, "config");
  const entry = path.join(config, "autostart", "openmausbot.desktop");
  const login = createOpenAtLogin({ app: fakeApp(), platform: "linux", home: dir, env: { XDG_CONFIG_HOME: config, APPIMAGE: "/home/me/OpenMausBot.AppImage" } });
  login.choose(true);
  assert.equal(await readFile(entry, "utf8"), autostartEntry("/home/me/OpenMausBot.AppImage"));
  assert.match(await readFile(entry, "utf8"), /^Exec="\/home\/me\/OpenMausBot\.AppImage"$/m);
  assert.equal(login.chosen(), true);
  login.choose(false);
  assert.equal(existsSync(entry), false);
  assert.equal(login.chosen(), false);
});

test("a build that cannot add a login item offers no switch and changes nothing", async t => {
  const dir = await temp(t);
  const app = fakeApp({ isPackaged: false });
  const login = createOpenAtLogin({ app, platform: "darwin", home: dir });
  const handlers = new Map();
  let redraws = 0;
  installOpenAtLogin({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, guard: (_channel, handler) => handler, loginItem: login, changed: () => redraws++ });
  assert.deepEqual(await handlers.get("open-at-login:state")({}), { available: false, on: false });
  await handlers.get("open-at-login:set")({}, true);
  assert.equal(app.getLoginItemSettings().openAtLogin, false);
  const packaged = createOpenAtLogin({ app: fakeApp(), platform: "darwin", home: dir });
  installOpenAtLogin({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, guard: (_channel, handler) => handler, loginItem: packaged, changed: () => redraws++ });
  assert.deepEqual(await handlers.get("open-at-login:set")({}, true), { available: true, on: true });
  assert.deepEqual(await handlers.get("open-at-login:set")({}, "yes"), { available: true, on: false }, "only a real true turns it on");
  assert.equal(redraws, 3, "the app menu's item is drawn again after each change");
});
