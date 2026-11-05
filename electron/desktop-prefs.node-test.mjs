import assert from "node:assert/strict";
import fs, { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createDesktopPrefs, DESKTOP_NOTICES, DESKTOP_PORTS, jsonFile, registerDesktopPrefs } from "./desktop-prefs.mjs";

const require = createRequire(import.meta.url);
const environments = require("./environments.cjs");
const localOrigin = require("./local-origin.cjs");

const GROK = "grok-move-2026-11";
const LOCAL = "http://127.0.0.1:18799", VPS = "https://bots.example.test";

test("the Grok Bot move is the notice a page can record; seen survives a restart; a broken record never stops the app", () => {
  assert.deepEqual([...DESKTOP_NOTICES], [GROK]);
  let saved = null;
  const writes = [];
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { writes.push(value); saved = structuredClone(value); } });
  assert.deepEqual(prefs.seen(), []);
  for (const id of ["other-notice", "boat-credit-2026-11", "__proto__", "", 42]) prefs.markSeen(id);
  assert.equal(writes.length, 0, "nothing a page names outside the list is written");
  prefs.markSeen(GROK); prefs.markSeen(GROK);
  assert.deepEqual(prefs.seen(), [GROK]); assert.equal(writes.length, 1);
  const restarted = createDesktopPrefs({ read: () => saved, write: value => { saved = value; } });
  assert.deepEqual(restarted.seen(), [GROK]);
  assert.deepEqual(createDesktopPrefs({ read: () => ({ seen: ["whats-new-2026-11", GROK, "boat-credit-2026-11"], analytics: false }), write: () => {} }).seen(), [GROK],
    "a record from an older app still reads: the notices it no longer has are dropped");

  const broken = createDesktopPrefs({ read: () => { throw new Error("unreadable"); }, write: () => { throw new Error("read-only disk"); } });
  assert.deepEqual(broken.seen(), []);
  broken.markSeen(GROK);
  assert.deepEqual(broken.seen(), [GROK], "kept for this launch when the file cannot be written");
  for (const record of ["nonsense", [GROK], { seen: "all", shown: [] }, { seen: [GROK, "<b>"], shown: { [GROK]: "today" } }]) {
    const prefs = createDesktopPrefs({ read: () => record, write: () => {} });
    assert.ok(prefs.seen().every(id => id === GROK), JSON.stringify(record));
  }
});

test("a write that fails leaves the last whole record on disk", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "desktop-prefs-"));
  try {
    const file = path.join(dir, "desktop-prefs.json");
    createDesktopPrefs(jsonFile(file)).setWindowFrame(false);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { seen: [], windowFrame: false });
    // As a full disk or a file-size limit does: the file is opened and emptied, then the write fails.
    const full = { ...fs, writeFileSync: target => { fs.writeFileSync(target, ""); throw Object.assign(new Error("file too large"), { code: "EFBIG" }); } };
    const launch = createDesktopPrefs({ ...jsonFile(file, full) });
    launch.markSeen(GROK);
    assert.deepEqual(launch.seen(), [GROK], "kept for this launch");
    assert.throws(() => jsonFile(file, full).write({ seen: [] }), /file too large/);
    assert.deepEqual(readdirSync(dir), ["desktop-prefs.json"], "no temporary file is left behind");
    const next = createDesktopPrefs(jsonFile(file));
    assert.equal(next.windowFrame(), false, "the last whole record survives");
    assert.deepEqual(next.seen(), []);
    assert.deepEqual(createDesktopPrefs(jsonFile(path.join(dir, "missing.json"))).seen(), [], "no file yet");
    const notepad = path.join(dir, "config.json");
    fs.writeFileSync(notepad, `\uFEFF${JSON.stringify({ seen: [GROK] })}`);
    assert.deepEqual(jsonFile(notepad).read(), { seen: [GROK] }, "a byte-order mark, as Notepad saves on Windows");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function desktopMain({ page = event => event.page, record = null } = {}) {
  const handlers = new Map(), listeners = new Map(), told = [];
  let saved = record;
  registerDesktopPrefs({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, listener) => listeners.set(channel, listener) },
    read: () => saved, write: value => { saved = structuredClone(value); }, page,
    languageChanged: (language, sender) => told.push([language, sender]),
    systemName: async () => "Ada Lovelace",
  });
  const ask = (channel, page, ...args) => handlers.get(channel)({ page, sender: `${page}-page` }, ...args);
  const answer = channel => page => { const event = { page }; listeners.get(channel)(event); return event.returnValue; };
  return { ask, language: answer("desktop-language:read"), told, channels: [...handlers.keys()], saved: () => saved };
}

test("every page of this desktop's window reads and records the same notices; nothing else is answered", async () => {
  const main = desktopMain();
  assert.deepEqual(main.channels, ["desktop-notices:state", "desktop-notices:seen", "desktop-profile:system-name", "desktop-language:set", "window-frame:state", "window-frame:set"]);
  for (const page of ["local", "server"]) assert.deepEqual(await main.ask("desktop-notices:state", page), { seen: [] });
  await main.ask("desktop-notices:seen", "server", GROK);
  assert.deepEqual(await main.ask("desktop-notices:state", "local"), { seen: [GROK] });
  for (const channel of main.channels) assert.throws(() => main.ask(channel, null, GROK), /only available in this app's window/, channel);
});

test("a first run's default name for the profile goes to this computer's own page only", async () => {
  const main = desktopMain();
  assert.equal(await main.ask("desktop-profile:system-name", "local"), "Ada Lovelace");
  assert.throws(() => main.ask("desktop-profile:system-name", "server"), /only available in this app's window/);
});

test("the app language picked on any page of the window is the one every page reads, and it outlives a restart", async () => {
  const main = desktopMain();
  for (const page of ["local", "server", null]) assert.equal(main.language(page), null, `System until a pick: ${page}`);
  assert.equal(await main.ask("desktop-language:set", "local", "en"), true);
  for (const page of ["local", "server"]) assert.equal(main.language(page), "en", page);
  assert.deepEqual(main.told, [["en", "local-page"]], "the other pages hear it");
  assert.equal(await main.ask("desktop-language:set", "server", "de"), true, "a saved server's page picks for this computer too");
  assert.equal(await main.ask("desktop-language:set", "server", "de"), true);
  assert.equal(main.language("local"), "de");
  assert.deepEqual(main.told, [["en", "local-page"], ["de", "server-page"]], "told once per change");
  assert.equal(await main.ask("desktop-language:set", "server", ""), true, "System is a pick too");
  assert.equal(main.language("server"), "");
  assert.equal(main.language(null), null, "a page outside this desktop's window is told nothing");
  for (const bad of ["../../etc", "<b>", "x".repeat(40), 42, null, undefined, { toString: () => "en" }]) {
    assert.equal(await main.ask("desktop-language:set", "local", bad), false, String(bad));
  }
  assert.throws(() => main.ask("desktop-language:set", null, "en"), /only available in this app's window/);
  assert.equal(main.language("local"), "");
  assert.equal(main.told.length, 3);

  const restarted = desktopMain({ record: main.saved() });
  assert.equal(restarted.language("server"), "");
  await restarted.ask("desktop-language:set", "local", "pt-br");
  assert.equal(desktopMain({ record: restarted.saved() }).language("server"), "pt-br");
  for (const record of [{ language: "<script>" }, { language: 7 }, { language: "x".repeat(40) }]) {
    assert.equal(createDesktopPrefs({ read: () => record, write: () => {} }).language(), null, JSON.stringify(record));
  }
  const broken = desktopMain({ page: () => { throw new Error("Object has been destroyed"); } });
  assert.equal(broken.language("local"), null);
});

const PRELOAD = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
function preload(origin, { activation = false, language = null } = {}) {
  let bridge;
  const invoked = [], synced = [], heard = new Map();
  vm.runInNewContext(PRELOAD, {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`] },
    location: { origin }, navigator: { userActivation: { isActive: activation } }, TextEncoder, localStorage: { getItem: () => null },
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { on(channel, handler) { heard.set(channel, handler); }, removeListener() {}, send() {},
        sendSync: channel => { synced.push(channel); return channel === "desktop-language:read" ? language : undefined; },
        invoke: (...args) => { invoked.push(args); return Promise.resolve(true); } } }),
  });
  return { bridge, invoked, synced, tell: (channel, ...args) => heard.get(channel)({}, ...args) };
}

test("the preload gives every page of the window the notices", async () => {
  for (const origin of [LOCAL, VPS]) {
    const page = preload(origin);
    await page.bridge.desktopNotices.state(); await page.bridge.desktopNotices.seen({ toString: () => GROK });
    assert.deepEqual(page.invoked, [["desktop-notices:state"], ["desktop-notices:seen", GROK]], origin);
    assert.deepEqual(Object.keys(page.bridge.desktopNotices), ["state", "seen"], "no page moves the window to this computer");
    assert.equal(page.bridge.desktopAnalytics, undefined, origin);
  }
  const safe = PRELOAD.match(/const REMOTE_SAFE = new Set\(\[([^\]]*)\]\)/)[1];
  assert.ok(safe.includes('"desktopNotices"'));
});

test("the preload gives every page of the window the app language this computer keeps", async () => {
  for (const origin of [LOCAL, VPS]) {
    const page = preload(origin, { language: "de" });
    assert.deepEqual(Object.keys(page.bridge.desktopLanguage), ["choice", "set", "onChange"], origin);
    const asked = () => page.synced.filter(channel => channel.startsWith("desktop-"));
    assert.deepEqual(asked(), [], "nothing is asked until the language is");
    assert.equal(page.bridge.desktopLanguage.choice(), "de", origin);
    assert.equal(page.bridge.desktopLanguage.choice(), "de");
    assert.deepEqual(asked(), ["desktop-language:read"], "asked once a page");
    await page.bridge.desktopLanguage.set("en");
    assert.equal(page.bridge.desktopLanguage.choice(), "en", "answered at once, before main replies");
    assert.deepEqual(page.invoked, [["desktop-language:set", "en"]]);
    const heard = [];
    const stop = page.bridge.desktopLanguage.onChange(language => heard.push(language));
    page.tell("desktop-language:changed", "ja");
    page.tell("desktop-language:changed", 42);
    assert.equal(page.bridge.desktopLanguage.choice(), "ja", "a pick made on another page");
    assert.deepEqual(heard, ["ja"]);
    stop();
    page.tell("desktop-language:changed", "fr");
    assert.deepEqual(heard, ["ja"]);
    assert.equal(page.bridge.desktopLanguage.choice(), "fr");
  }
  assert.equal(preload(VPS, { language: 7 }).bridge.desktopLanguage.choice(), null);
  const safe = PRELOAD.match(/const REMOTE_SAFE = new Set\(\[([^\]]*)\]\)/)[1];
  assert.ok(safe.includes('"desktopLanguage"'));
});

test("production wiring: main answers this computer's page and the server's own page, and no other", async () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /for \(const port of DESKTOP_PORTS\)/, "main tries the ports this module names, in order");
  assert.deepEqual([...DESKTOP_PORTS], [8799, 18799, 28799]);
  const start = main.indexOf("  desktopPrefs = createDesktopPrefs("), end = main.indexOf("\n", main.indexOf("page:", start));
  assert.ok(start >= 0 && end > start, "main.mjs registers the desktop prefs");
  let options = null;
  const localFrame = { url: `${LOCAL}/` }, serverFrame = { url: `${VPS}/` };
  const contents = { mainFrame: serverFrame };
  localOrigin.setLocalOrigin(LOCAL);
  const sent = [], window = name => ({ isDestroyed: () => name === "closed", webContents: { send: (...message) => sent.push([name, ...message]) } });
  const windows = [window("team"), window("home"), window("closed")];
  let broadcasts = 0;
  const context = vm.createContext({
    registerDesktopPrefs: value => { options = value; }, createDesktopPrefs: store => ({ store }), jsonFile: file => ({ read: () => file, write: () => {} }), ipcMain: {},
    path: { join: (...parts) => parts.join("/") }, app: { getPath: () => "/user-data" }, desktopDataDir: () => "/home/.openmausbot",
    senderIsLocal: localOrigin.isLocalSender, workspaceSenderAllowed: environments.workspaceSenderAllowed,
    mainWindow: { webContents: contents }, placeState: environments.withServer(environments.LOCAL_PLACE, { origin: VPS, name: "VPS" }),
    appWindows: () => windows, BrowserWindow: { getAllWindows: () => windows },
    rendererOrigin: () => LOCAL,
    process: { platform: "win32" }, windowFrameMade: false, broadcastDesktopCapabilities: async () => { broadcasts++; },
  });
  vm.runInContext(main.slice(start, end), context);
  assert.equal(options.prefs.store.read(), "/user-data/desktop-prefs.json");
  assert.deepEqual([options.frame.made(), options.frame.restarts], [false, true], "Windows: the frame its window was made with, until a restart");
  options.frame.changed();
  assert.equal(broadcasts, 1, "the pages hear the frame change");
  assert.equal(options.page({ sender: { mainFrame: localFrame }, senderFrame: localFrame }), "local");
  assert.equal(options.page({ sender: contents, senderFrame: serverFrame }), "server");
  assert.equal(options.page({ sender: contents, senderFrame: { url: `${VPS}/` } }), null, "a frame inside the server's page");
  assert.equal(options.page({ sender: {}, senderFrame: serverFrame }), null, "another window");
  const evil = { url: "https://evil.example.test/" };
  assert.equal(options.page({ sender: { mainFrame: evil }, senderFrame: evil }), null, "a page that is not the server");
  assert.equal(options.cloudOffered, undefined);
  options.languageChanged("en", windows[0].webContents);
  assert.deepEqual(sent, [["home", "desktop-language:changed", "en"]], "every other open window hears the pick");
  const navigate = main.slice(main.indexOf("function navigateMainWindow(url) {"), main.indexOf("\n}\n", main.indexOf("function navigateMainWindow(url) {")) + 3);
  const load = vm.runInNewContext(`${navigate}; navigateMainWindow`, { mainWindow: { isDestroyed: () => false, loadURL: async url => { if (url.endsWith("fail")) throw new Error("ERR_CONNECTION_REFUSED"); } } });
  assert.equal(await load(`${LOCAL}/ok`), true); assert.equal(await load(`${LOCAL}/fail`), false, "a failed load answers false, never throws");
  assert.equal(await vm.runInNewContext(`${navigate}; navigateMainWindow`, { mainWindow: null })(`${LOCAL}/`), false, "no window");
});

test("the talk shortcut is on with ⌃⌥Space until changed, and the choice survives a restart", () => {
  let saved = null;
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); } });
  assert.equal(prefs.talkShortcut(), true);
  assert.equal(prefs.talkKey(), "ctrl-opt-space");
  prefs.setTalkShortcut(false);
  assert.equal(prefs.setTalkKey("opt-shift-space"), true);
  for (const key of ["cmd-space", "__proto__", "toString", 7]) assert.equal(prefs.setTalkKey(key), false);
  const restarted = createDesktopPrefs({ read: () => saved, write: () => {} });
  assert.equal(restarted.talkShortcut(), false);
  assert.equal(restarted.talkKey(), "opt-shift-space");
  const junk = createDesktopPrefs({ read: () => ({ talkShortcut: "off", talkKey: "toString" }), write: () => {} });
  assert.equal(junk.talkShortcut(), true);
  assert.equal(junk.talkKey(), "ctrl-opt-space");
});

test("each server keeps its own Quick asks chat; nothing malformed is read back", () => {
  let saved = null;
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); } });
  prefs.setQuickAsksChat("/Users/a/.openmausbot", { botId: "bot-1", threadId: "t-1" });
  assert.deepEqual(createDesktopPrefs({ read: () => saved, write: () => {} }).quickAsksChat("/Users/a/.openmausbot"), { botId: "bot-1", threadId: "t-1" });
  assert.equal(prefs.quickAsksChat("/Users/a/.openmausbot-aprs"), null);
  const broken = createDesktopPrefs({ read: () => ({ quickAsks: { a: { botId: "../x", threadId: "t" }, b: "t-1", c: { botId: "b", threadId: "t", extra: 1 } } }), write: () => {} });
  assert.equal(broken.quickAsksChat("a"), null);
  assert.equal(broken.quickAsksChat("b"), null);
  assert.deepEqual(broken.quickAsksChat("c"), { botId: "b", threadId: "t" });
});

test("the window draws its own frame until the person turns it off, and the choice survives a restart", () => {
  let saved = null, writes = 0;
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); writes++; } });
  assert.equal(prefs.windowFrame(), true);
  prefs.setWindowFrame(true);
  assert.equal(writes, 0, "turning on a frame that is on writes nothing");
  prefs.setWindowFrame(false);
  assert.equal(createDesktopPrefs({ read: () => saved, write: () => {} }).windowFrame(), false);
  prefs.setWindowFrame("off");
  assert.equal(createDesktopPrefs({ read: () => saved, write: () => {} }).windowFrame(), true, "only false turns it off");
  assert.equal(createDesktopPrefs({ read: () => ({ windowFrame: "no" }), write: () => {} }).windowFrame(), true);
});

test("Settings reads and changes the window's frame on any page of the window; on Windows the change waits for a restart", async () => {
  const prefs = createDesktopPrefs({ read: () => null, write: () => {} });
  const handlers = new Map();
  let made = true, changes = 0, asking = "server";
  const register = (restarts) => registerDesktopPrefs({ prefs, ipcMain: { handle: (c, h) => handlers.set(c, h), on: () => {} }, read: () => null, write: () => {},
    page: () => asking, cloudOffered: async () => false, frame: { made: () => made, restarts, changed: () => { changes++; } } });
  register(false);
  assert.deepEqual(await handlers.get("window-frame:state")({}), { on: true, restart: false });
  assert.deepEqual(await handlers.get("window-frame:set")({}, false), { on: false, restart: false }, "macOS: at once");
  assert.equal(changes, 1, "the pages hear it");
  register(true);
  assert.deepEqual(await handlers.get("window-frame:state")({}), { on: false, restart: true }, "Windows: the window was made with its frame");
  assert.deepEqual(await handlers.get("window-frame:set")({}, true), { on: true, restart: false }, "back as it was made: nothing to restart");
  made = null;
  assert.deepEqual(await handlers.get("window-frame:set")({}, false), { on: false, restart: false }, "no window yet");
  asking = null;
  assert.throws(() => handlers.get("window-frame:set")({}, true), /only available in this app's window/);
});

test("registerDesktopPrefs works on the store main hands it", async () => {
  const prefs = createDesktopPrefs({ read: () => null, write: () => {} });
  const handlers = new Map();
  registerDesktopPrefs({ prefs, ipcMain: { handle: (c, h) => handlers.set(c, h), on: () => {} }, read: () => null, write: () => {}, page: () => "local" });
  await handlers.get("desktop-notices:seen")({}, GROK);
  assert.deepEqual(prefs.seen(), [GROK]);
});
