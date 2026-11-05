import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const env = require("./environments.cjs");
const MAIN = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const PRELOAD = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const LOCAL = "http://127.0.0.1:8799";
const VPS = "https://bots.example.com";
const LINK = `${VPS}/pair#code=ABCD-EFGH-JKLM`;
// vm realms have their own Object/Array prototypes: bring results home before strict-comparing.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

function section(start, end) {
  const from = MAIN.indexOf(start), to = MAIN.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `main.mjs section moved: ${start}`);
  return MAIN.slice(from, to);
}

/** main's own place actions, with Electron faked: `answer` is the native dialog's button. */
function harness({ state = env.LOCAL_PLACE, answer = 0, logout = async () => ({ ok: true }), health = async () => new Response(JSON.stringify({ app: "openmausbot" })) } = {}) {
  const calls = { dialogs: [], saved: [], navigated: [], logouts: [], cleared: [], health: [] };
  const context = vm.createContext({
    ...env, placeState: state, URL, AbortSignal, Promise,
    fetch: async (url) => { calls.health.push(url); return health(url); },
    showMessage: async (options) => { calls.dialogs.push(options); return { response: answer }; },
    dialog: { showMessageBox: async (options) => { calls.dialogs.push(options); return { response: 0 }; } },
    clipboard: { readText: () => LINK },
    savePlace: (next) => { calls.saved.push(next); context.placeState = next; },
    navigateMainWindow: async (url) => { calls.navigated.push(url); return true; },
    rendererOrigin: () => LOCAL,
    remoteMicrophoneRefused: new Set([VPS]),
    session: { defaultSession: {
      fetch: async (url, init) => { calls.logouts.push([url, init.method]); return logout(); },
      clearStorageData: async (options) => { calls.cleared.push(options); },
    } },
    slog: () => {},
  });
  vm.runInContext(`${section("async function connectServer(input) {", "let unreachableAsked")}
    Object.assign(this, { connectServer, connectFromClipboard, disconnectServer, disconnectFromMenu });`, context);
  return { context, calls };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("connect refuses anything but a server address or a pairing link with its code in the hash, and asks nothing", async () => {
  for (const bad of ["", "not a link", "https://bots.example.com/?code=SECRET", "javascript:alert(1)"]) {
    const h = harness();
    const result = plain(await h.context.connectServer(bad));
    assert.equal(result.ok, false, bad);
    assert.match(result.error, /pairing link/);
    assert.deepEqual([h.calls.dialogs, h.calls.saved, h.calls.navigated], [[], [], []]);
  }
});

test("connect shows the server only once the person confirms its host natively, and opens the pairing page", async () => {
  const declined = harness({ answer: 1 });
  assert.deepEqual(plain(await declined.context.connectServer(LINK)), { ok: false, error: "cancelled" });
  assert.deepEqual([declined.calls.saved, declined.calls.navigated], [[], []]);
  assert.equal(declined.calls.dialogs[0].message, "Connect to bots.example.com?");

  const h = harness();
  assert.deepEqual(plain(await h.context.connectServer(LINK)), { ok: true });
  assert.deepEqual(plain(h.calls.saved), [{ server: { origin: VPS, name: "bots.example.com" }, active: "server" }]);
  assert.deepEqual(h.calls.navigated, [LINK]);
  assert.deepEqual(h.calls.logouts, [], "nothing to sign out of");
  assert.deepEqual(h.calls.health, [`${VPS}/api/health`]);
  assert.deepEqual(declined.calls.health, [], "nothing is probed before the person confirms");
});

test("connect keeps this computer when the server doesn't answer as Openpals", async () => {
  for (const health of [async () => { throw new Error("ECONNREFUSED"); }, async () => new Response("<html>", { status: 502 }), async () => new Response(JSON.stringify({ app: "other" }))]) {
    const h = harness({ health });
    assert.deepEqual(plain(await h.context.connectServer(LINK)), { ok: false, error: "unreachable" });
    assert.deepEqual([h.calls.saved, h.calls.navigated], [[], []]);
  }
  const menu = harness({ health: async () => { throw new Error("ECONNREFUSED"); } });
  await menu.context.connectFromClipboard();
  assert.match(menu.calls.dialogs.at(-1).detail, /didn't answer/);
});

test("connecting to another server signs this app out of the one it showed", async () => {
  const old = env.withServer(env.LOCAL_PLACE, { origin: "https://old.example.net", name: "Old" });
  const h = harness({ state: old });
  assert.deepEqual(plain(await h.context.connectServer(LINK)), { ok: true });
  await settle();
  assert.deepEqual(h.calls.logouts, [["https://old.example.net/api/auth/logout", "POST"]]);
  assert.deepEqual(plain(h.calls.cleared), [{ origin: "https://old.example.net", storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] }]);
  assert.equal(env.activeServer(h.context.placeState).origin, VPS);
});

test("disconnect forgets the server, signs out, clears its cookies and goes back to this computer's page", async () => {
  const h = harness({ state: env.withServer(env.LOCAL_PLACE, { origin: VPS, name: "VPS" }) });
  await h.context.disconnectServer();
  assert.deepEqual(plain(h.calls.saved), [plain(env.LOCAL_PLACE)]);
  assert.deepEqual(h.calls.navigated, [LOCAL]);
  assert.deepEqual(h.calls.logouts, [[`${VPS}/api/auth/logout`, "POST"]]);
  assert.deepEqual(plain(h.calls.cleared), [{ origin: VPS, storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] }]);
  assert.equal(h.context.remoteMicrophoneRefused.has(VPS), false, "a refused microphone is asked again next time");
  assert.equal(h.calls.dialogs.length, 0, "the page's own click is the person's choice");
});

test("disconnect still forgets a server that does not answer, and keeps the cookies of a host this app still uses", async () => {
  const h = harness({ state: env.withServer(env.LOCAL_PLACE, { origin: "http://127.0.0.1:19999" }), logout: async () => { throw new Error("ECONNREFUSED"); } });
  await h.context.disconnectServer();
  assert.deepEqual(plain(h.calls.saved), [plain(env.LOCAL_PLACE)]);
  assert.deepEqual(plain(h.calls.cleared), [{ origin: "http://127.0.0.1:19999", storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage"] }],
    "cookies are per host: this computer's own server on 127.0.0.1 keeps its own");
});

test("disconnect on this computer changes nothing; the menu asks first", async () => {
  const local = harness();
  await local.context.disconnectServer();
  assert.deepEqual([local.calls.saved, local.calls.navigated, local.calls.logouts], [[], [], []]);
  const kept = harness({ state: env.withServer(env.LOCAL_PLACE, { origin: VPS, name: "VPS" }), answer: 1 });
  await kept.context.disconnectFromMenu();
  assert.equal(kept.calls.dialogs[0].message, "Disconnect from “VPS”?");
  assert.deepEqual(kept.calls.saved, [], "Cancel keeps the server");
});

test("main answers the place channels only for the main window's own page, and the preload gates changes on a click", async () => {
  for (const channel of ["place:current", "place:connect", "place:disconnect"]) {
    assert.match(MAIN, new RegExp(`ipcMain\\.handle\\("${channel}", workspaceOnly\\(`), channel);
  }
  assert.match(MAIN, /mainWindow\.webContents\.send\("place:changed", placeView\(placeState\)\);/);
  const invoked = [];
  const page = (origin, activation) => {
    let bridge;
    vm.runInNewContext(PRELOAD, {
      process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`] }, location: { origin },
      navigator: { userActivation: { isActive: activation } },
      require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
        ipcRenderer: { on() {}, removeListener() {}, send() {}, sendSync() {}, invoke: (...args) => { invoked.push(args); return Promise.resolve({ ok: true }); } } }),
    });
    return bridge;
  };
  const server = page(VPS, false);
  assert.deepEqual(Object.keys(server.place), ["current", "connect", "disconnect", "onChanged"]);
  await server.place.current();
  await assert.rejects(server.place.connect(LINK));
  await assert.rejects(server.place.disconnect());
  assert.deepEqual(invoked, [["place:current"]], "a server's page changes nothing without the person's click");
  await page(VPS, true).place.disconnect();
  await page(LOCAL, false).place.connect(LINK);
  assert.deepEqual(invoked.slice(1), [["place:disconnect"], ["place:connect", LINK]]);
});
