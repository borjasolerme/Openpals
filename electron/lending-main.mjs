// "Let bots use this computer": main's side of lending this computer to the servers the person added with a link from
// "Add a computer". It owns the lending client, the menu-bar item, main's own confirmations and the IPC the Settings card
// calls. A page can ask; only the person's answer in main's dialog lends it, or turns folders or the terminal on.
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

import { createComputerSharing, isHomeFolder, parseLendLink, validateSharedFolders } from "./computer-sharing.mjs";
import { createActivityWindow } from "./lending-activity-window.mjs";
import { createLendingDialogs } from "./lending-dialogs.mjs";
import { createLendingIndicator, deviceWord } from "./lending-indicator.mjs";
import { createScreenControl } from "./screen-control.mjs";

/** macOS's own Privacy & Security panes, opened for the person; nothing is granted from here. */
export const PRIVACY_PANES = Object.freeze({
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
});

/** The name a Mac goes by in Finder and AirDrop ("Borja's Mac mini"), else the host name without ".local". */
export function readComputerName({ platform = process.platform, run = execFile } = {}) {
  const fallback = os.hostname().replace(/\.local$/i, "");
  if (platform !== "darwin") return Promise.resolve(fallback);
  return new Promise((resolve) => {
    run("/usr/sbin/scutil", ["--get", "ComputerName"], { timeout: 3000 }, (error, stdout) => {
      const name = error ? "" : String(stdout).trim();
      resolve(name || fallback);
    });
  });
}

export function installLending({
  ipcMain, guard, dialog, shell, Tray, Menu, nativeImage, BrowserWindow, iconPath, background, locale,
  userData, protectedPaths, fetch, cuaConnection, requestComputerUse, screenLocked, idleSeconds, hostControl,
  window, openSettings, send, loginItem, platform = process.platform, log = () => {},
}) {
  const device = deviceWord(platform);
  let computerName = os.hostname().replace(/\.local$/i, "");
  void readComputerName({ platform }).then((name) => { computerName = name; });
  const screen = createScreenControl({ connection: cuaConnection, request: requestComputerUse, log, platform });
  const dialogs = createLendingDialogs({ dialog, window, validate: validateSharedFolders, isHome: isHomeFolder, device });
  const activityWindow = createActivityWindow({ BrowserWindow, icon: iconPath, background, entries: () => sharing.activity(200), locale });
  const indicator = createLendingIndicator({
    Tray, Menu, nativeImage, iconPath, device,
    onPause: () => void sharing.pause(),
    onResume: () => sharing.resume(),
    onStop: () => void sharing.turnOff(),
    onActivity: () => activityWindow.show(),
    onOpenSettings: openSettings,
    onStartScreen: () => void screen.start().then(() => sharing.readScreen()),
    onTerminal: (on) => void dialogs.lendTerminal(on, async () => { sharing.setTerminal(on); }).catch((error) => log(`lending terminal: ${error?.message ?? error}`)),
  });
  const sharing = createComputerSharing({
    file: path.join(userData, "computer-sharing.json"), protectedPaths, fetch, platform,
    cuaConnection, screen: screen.now, hostControl, screenLocked, idleSeconds, computerName: () => computerName, log,
    onChange: (summary) => {
      indicator.update(summary);
      try { send("lending:changed", summary); } catch {}
    },
  });
  indicator.update(sharing.summary());

  const state = async () => ({
    ...sharing.view(),
    device,
    platform,
    screen: await sharing.readScreen(),
    openAtLogin: loginItem.available() ? loginItem.chosen() : null,
  });
  const handle = (channel, run) => ipcMain.handle(channel, guard(async (_event, ...args) => { await run(...args); return state(); }));

  const servers = () => sharing.summary().targets.map((target) => target.serverName).join(", ");

  /** On a Mac, straight to the two permissions macOS asks for, once lending starts and the screen can't be used yet. */
  const walkToPermissions = async () => {
    if (platform !== "darwin" || !sharing.summary().lendsScreen) return;
    if ((await sharing.readScreen())?.ready) return;
    await screen.start();
    if ((await sharing.readScreen())?.reason === "permissions") await shell.openExternal(PRIVACY_PANES.accessibility).catch(() => {});
  };

  /**
   * A link from "Add a computer", pasted here: the one question, in main's own dialog, then this computer's lend-only
   * session on that server. Never changes which server this app shows. { ok, serverName } or { ok: false, error }.
   */
  const addLink = async (input) => {
    const link = parseLendLink(input);
    if (!link) return { ok: false, error: "This isn't a link from Add a computer." };
    const serverName = await sharing.serverName(link.origin);
    if (!(await dialogs.confirmLending(serverName))) return { ok: false, error: "cancelled" };
    try {
      await sharing.addTarget(link, { serverName });
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
    openSettings();
    void walkToPermissions();
    return { ok: true, serverName };
  };

  ipcMain.handle("lending:state", guard(() => state()));
  handle("lending:add-link", async (link) => {
    const result = await addLink(String(link ?? ""));
    if (!result.ok && result.error !== "cancelled") throw new Error(result.error);
  });
  handle("lending:target-pause", (id) => sharing.pauseTarget(String(id ?? "")));
  handle("lending:target-resume", (id) => sharing.resumeTarget(String(id ?? "")));
  handle("lending:target-remove", (id) => sharing.removeTarget(String(id ?? "")));
  handle("lending:turn-on", async () => {
    if (await dialogs.confirmLending(servers())) sharing.turnOn();
  });
  handle("lending:turn-off", () => sharing.turnOff());
  handle("lending:pause", () => sharing.pause());
  handle("lending:resume", async () => {
    if (await dialogs.confirmLending(servers())) sharing.resume();
  });
  handle("lending:rename", (name) => sharing.rename(typeof name === "string" ? name : ""));
  handle("lending:terminal", (on) => dialogs.lendTerminal(on === true, async () => { sharing.setTerminal(on === true); }));
  handle("lending:screen", async (on) => {
    if (on !== true) sharing.setScreen(false);
    else if (await dialogs.confirmLending(servers())) sharing.setScreen(true);
  });
  handle("lending:add-folder", async () => {
    const folder = await dialogs.chooseFolder(`Choose a folder your bots may use on this ${device}`);
    const lent = sharing.lentFolders();
    if (!folder || lent.length >= 20 || lent.some((entry) => entry.path === folder.path)) return;
    sharing.setFolders([...lent, folder]);
  });
  handle("lending:remove-folder", (id) => sharing.setFolders(sharing.lentFolders().filter((folder) => folder.id !== id)));
  handle("lending:allow-screen", async () => { await screen.start(); });
  handle("lending:privacy", async (pane) => {
    if (platform !== "darwin" || !Object.hasOwn(PRIVACY_PANES, pane)) return;
    await shell.openExternal(PRIVACY_PANES[pane]);
  });
  handle("lending:open-at-login", (on) => { if (loginItem.available()) loginItem.choose(on === true); });
  ipcMain.handle("lending:activity", guard(() => { activityWindow.show(); }));

  return {
    sharing,
    addLink,
    screenChanged: () => void sharing.readScreen(),
    close() {
      sharing.close();
      indicator.destroy();
      activityWindow.close();
    },
  };
}
