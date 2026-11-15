// Whether this computer's apps and screen are lent to the person's own Clouds, and what the icon's menu says when they
// aren't: read from computer control's own state on Windows, macOS and Linux.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLendingIndicator, indicatorText } from "./lending-indicator.mjs";
import { screenStatus } from "./screen-status.mjs";
import { screenFixLabel, screenLine } from "./screen-words.mjs";
import { driverFailure } from "./cua-failure.mjs";

const embedded = (extra = {}) => ({
  mode: "embedded", socketPath: "\\\\.\\pipe\\cua-driver-1234", mcpCommand: "C:\\Program Files\\OpenMausBot\\resources\\cua-driver.exe",
  mcpArgs: ["mcp", "--embedded", "--socket", "\\\\.\\pipe\\cua-driver-1234"], mcpEnv: { CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_HOST_BUNDLE_ID: "com.openpals.app" }, ...extra,
});

test("a PC lends its apps and screen once its own embedded computer control runs, and never through another driver", () => {
  assert.deepEqual(screenStatus({ platform: "win32", connection: embedded() }), { ready: true, lent: true, reason: null, fix: null });
  // A driver the person installed themselves answers on a pipe this app does not own.
  const standalone = screenStatus({ platform: "win32", connection: embedded({ mode: "standalone" }) });
  assert.deepEqual({ lent: standalone.lent, reason: standalone.reason }, { lent: false, reason: "not-running" });
  for (const broken of [embedded({ socketPath: "" }), embedded({ mcpArgs: ["serve"] }), embedded({ mcpEnv: { CUA_DRIVER_EMBEDDED: 1 } }), embedded({ status: "error" })]) {
    assert.equal(screenStatus({ platform: "win32", connection: broken }).lent, false, JSON.stringify(broken));
  }
  assert.equal(screenStatus({ platform: "win32", connection: embedded(), remote: true }).lent, false, "a remote companion lends nothing of this computer");
});

test("why a PC's apps and screen aren't lent, and the one fix", () => {
  const starting = screenStatus({ platform: "win32", connection: { mode: "unavailable", reason: "not-started" } });
  assert.deepEqual({ reason: starting.reason, fix: starting.fix }, { reason: "starting", fix: null });
  const timedOut = screenStatus({ platform: "win32", connection: { mode: "unavailable", reason: "embedded host failed: StartupTimeout: timeoutMs 10000" } });
  assert.deepEqual({ reason: timedOut.reason, fix: timedOut.fix }, { reason: "not-running", fix: "start" });
  for (const reason of [
    "embedded host failed: Spawn: binaryPath C:\\OpenMausBot\\resources\\cua-driver-background.exe; reason Access is denied. (os error 5)",
    "embedded host failed: Spawn: reason Operation did not complete successfully because the file contains a virus or potentially unwanted software. (os error 225)",
    "cua-driver binary not found",
    "embedded host failed: Packaged background CUA driver is missing; reinstall Openpals",
  ]) {
    const blocked = screenStatus({ platform: "win32", connection: { mode: "unavailable", reason } });
    assert.deepEqual({ reason: blocked.reason, fix: blocked.fix }, { reason: "blocked", fix: "start" }, reason);
  }
  assert.equal(screenLine(timedOut, "PC"), "Screen control isn't running on this PC");
  assert.equal(screenFixLabel(timedOut), "Start screen control");
  assert.equal(screenLine({ ready: false, reason: "blocked" }, "PC"), "Screen control is blocked: Windows Security may have stopped it");
});

test("a Mac lacking only macOS's permissions still lends them, so a bot's first need asks macOS; Linux control is off until turned on", () => {
  const mac = screenStatus({ platform: "darwin", connection: { mode: "unavailable", reason: "embedded host failed: Accessibility and Screen Recording required; grant access in System Settings and restart Openpals" } });
  assert.deepEqual(mac, { ready: false, lent: true, reason: "permissions", fix: "allow" });
  assert.equal(screenFixLabel(mac), "Allow screen control…");
  const linux = screenStatus({ platform: "linux", connection: { schemaVersion: 1, platform: "linux", mode: "unavailable", enabled: false, status: "disabled", reasonCode: "opt-in-required" } });
  assert.deepEqual({ lent: linux.lent, reason: linux.reason, fix: linux.fix }, { lent: false, reason: "off", fix: "start" });
  assert.equal(screenFixLabel(linux), "Turn on screen control");
  const wayland = screenStatus({ platform: "linux", connection: { mode: "unavailable", status: "unavailable", reasonCode: "linux-wayland-seat-safety-blocked",
    message: "Local control is not available on Wayland yet. Sign out and choose Ubuntu on Xorg to use This computer." } });
  assert.deepEqual({ reason: wayland.reason, fix: wayland.fix }, { reason: "unsupported", fix: null });
  assert.equal(screenFixLabel(wayland), null, "nothing here can fix a Wayland session");
});

test("the icon's menu says plainly what the server's bots can't use, why, and offers the fix and the stop", () => {
  const notRunning = screenStatus({ platform: "win32", connection: { mode: "unavailable", reason: "desktop-host-stopped" } });
  const online = { server: "Boat server", paused: false, state: "online", busy: null };
  assert.deepEqual(indicatorText({ ...online, screen: notRunning }, "PC"),
    { line: "Bots on Boat server can use this PC, but not its apps and screen", title: "", screen: "Screen control isn't running on this PC" });
  assert.deepEqual(indicatorText({ ...online, screen: { ready: true, reason: null } }, "PC"),
    { line: "Bots on Boat server can use this PC", title: "", screen: null });
  assert.deepEqual(indicatorText({ ...online, busy: { action: "computer_call" }, screen: { ready: true } }, "Mac"),
    { line: "A bot on Boat server is using this Mac", title: "In use", screen: null });
  assert.equal(indicatorText({ ...online, paused: true, screen: notRunning }, "PC").screen, null, "paused says only that");
  assert.equal(indicatorText({ ...online, state: "offline" }, "Mac").line, "Can't reach Boat server now; this Mac keeps trying");

  const trays = [];
  let started = 0, stopped = 0;
  class Tray { constructor() { trays.push(this); } on() {} setToolTip(tip) { this.tip = tip; } setTitle() {} setContextMenu(menu) { this.menu = menu; } isDestroyed() { return this.gone === true; } destroy() { this.gone = true; } }
  const indicator = createLendingIndicator({ Tray, Menu: { buildFromTemplate: items => items }, nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, iconPath: "",
    onPause: () => {}, onResume: () => {}, onStop: () => { stopped++; }, onActivity: () => {}, onTerminal: () => {}, onStartScreen: () => { started++; }, device: "PC" });
  indicator.update({ on: true, ...online, screen: notRunning });
  const [line, why, fix] = trays[0].menu;
  assert.deepEqual([line.label, line.enabled, why.label, why.enabled, fix.label], ["Bots on Boat server can use this PC, but not its apps and screen", false, "Screen control isn't running on this PC", false, "Start screen control"]);
  assert.equal(trays[0].tip, "Openpals: Bots on Boat server can use this PC, but not its apps and screen. Screen control isn't running on this PC");
  fix.click();
  assert.equal(started, 1, "one click starts screen control");
  indicator.update({ on: true, ...online, screen: { ready: true, lent: true, reason: null, fix: null } });
  assert.deepEqual(trays[0].menu.filter(item => item.label).map(item => item.label), ["Bots on Boat server can use this PC", "Pause", "Let bots run commands on this PC", "See activity", "Settings…", "Stop lending this PC"]);
  trays[0].menu.find(item => item.label === "Stop lending this PC").click();
  assert.equal(stopped, 1);
  indicator.update({ on: false });
  assert.equal(trays[0].isDestroyed(), true, "nothing is shown once lending is off");
});

test("a failed start keeps the reason Windows gave, not only the kind of failure", () => {
  const spawn = Object.assign(new Error("EmbeddedDriverError.Spawn"), { tag: "Spawn", inner: { binaryPath: "C:\\x\\cua-driver-background.exe", reason: "Access is denied. (os error 5)" } });
  assert.equal(driverFailure(spawn), "Spawn: binaryPath C:\\x\\cua-driver-background.exe; reason Access is denied. (os error 5)");
  assert.equal(driverFailure(Object.assign(new Error("EmbeddedDriverError.StartupTimeout"), { tag: "StartupTimeout", inner: { timeoutMs: 10_000n } })), "StartupTimeout: timeoutMs 10000");
  assert.equal(driverFailure(new Error("plain")), "plain");
});
