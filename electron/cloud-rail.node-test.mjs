import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { installCloudRail, railPlaces } from "./cloud-rail.mjs";

const VPS = "https://bots.example.test", BOX = "https://box.example.test";
const LOCAL = "http://127.0.0.1:8799";
const saved = (activeId = "local", extra = []) => ({ activeId, environments: [
  { id: "vps", kind: "remote", name: "Bots VPS", origin: VPS, color: "teal" },
  { id: "lab", kind: "local", name: "Lab", dataDir: "/Users/me/.openmausbot-lab" },
  ...extra,
] });

test("the rail: this computer, then the servers saved by hand; names, colours and states, never an address", () => {
  const places = railPlaces({ saved: saved("vps") });
  assert.deepEqual(places, [
    { id: "local", name: "This computer", color: null, kind: "computer", opens: true, paint: { swatch: null } },
    { id: "vps", name: "Bots VPS", color: "teal", kind: "server", opens: true, paint: { swatch: "green" }, active: true, removable: true, forget: true },
  ]);
  assert.ok(!JSON.stringify(places).includes("example.test"), "no address reaches the rail's page");
});

test("one place, or none: no rail, the window as it was; once a server is home, this computer is no place of its own", () => {
  assert.deepEqual(railPlaces({ saved: { activeId: "local", environments: [] } }), []);
  assert.deepEqual(railPlaces({ saved: saved(), home: VPS }), [], "the home alone is no rail");
  assert.deepEqual(railPlaces({ saved: saved("vps", [{ id: "box", kind: "remote", name: "Box", origin: BOX }]), home: VPS }).map(place => place.id), ["vps", "box"]);
});

function rail(over = {}) {
  const handlers = new Map(), opened = [], ran = [], sent = [], forgotten = [], made = [];
  const w = { lists: true, beside: true, offered: new Set(["vps"]) };
  const installed = installCloudRail({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, guard: handler => handler,
    lists: () => w.lists, beside: () => w.beside,
    places: () => railPlaces({ saved: saved("local", [{ id: "box", kind: "remote", name: "Box", origin: BOX }]), offers: entry => w.offered.has(entry.id) }),
    open: id => opened.push(id), add: { choices: () => ({ link: true, address: false }), run: (...args) => ran.push(args) },
    makeHome: id => { made.push(id); return { started: true }; }, forget: async id => { forgotten.push(id); },
    targets: () => [{ isDestroyed: () => false, send: (channel) => sent.push(`page:${channel}`) }, null,
      { isDestroyed: () => false, send: (channel) => sent.push(`rail:${channel}`) }], ...over });
  return { handlers, opened, ran, sent, forgotten, made, w, installed, call: (channel, ...args) => handlers.get(channel)({ sender: {} }, ...args) };
}

test("the rail's channels: the list only for the rail's own page, a circle only by an id main listed, ＋ only its fixed choices", async () => {
  const r = rail();
  assert.deepEqual((await r.call("workspaces:places")).places.map(place => place.id), ["local", "vps", "box"]);
  r.w.lists = false;
  assert.deepEqual(await r.call("workspaces:places"), { places: [], add: { link: false, address: false }, beside: true },
    "a place's page, this computer's included, learns only that the rail stands beside it");
  r.w.beside = false;
  assert.deepEqual(await r.call("workspaces:places"), { places: [], add: { link: false, address: false } });
  assert.throws(() => r.call("workspaces:open", "vps"), /only available/);
  assert.throws(() => r.call("workspaces:add", "link"), /only available/);
  r.w.lists = true;
  r.call("workspaces:open", "vps");
  assert.throws(() => r.call("workspaces:open", "https://evil.example.test"), /isn't here/);
  assert.throws(() => r.call("workspaces:open", "lab"), /isn't here/, "a local environment is the Server menu's, not the rail's");
  r.call("workspaces:add", "link");
  r.call("workspaces:add", "link", "  https://bots.example.test/#pair=abc  ");
  r.call("workspaces:add", "link", { href: "https://evil.example.test" });
  r.call("workspaces:add", "link", "x".repeat(5000));
  assert.throws(() => r.call("workspaces:add", "address"), /isn't something/, "not offered here");
  assert.throws(() => r.call("workspaces:add", "cloud"), /isn't something/);
  assert.deepEqual([r.opened, r.ran], [["vps"], [["link"], ["link", "https://bots.example.test/#pair=abc"], ["link"], ["link", "x".repeat(4096)]]],
    "a pasted link reaches main's own Connect dialog trimmed and bounded; anything but text is the clipboard's");
  r.installed.changed(); r.installed.changed();
  assert.deepEqual(r.sent, ["page:workspaces:changed", "rail:workspaces:changed"], "a signal only, to the page and the rail, and once per change");
  r.w.beside = true;
  r.installed.changed();
  assert.deepEqual(r.sent.slice(2), ["page:workspaces:changed", "rail:workspaces:changed"], "the rail came beside the page (or went): the page reads it again");
});

test("Make … my home: only on a server connected by hand that main offers it for, from the rail's own page, by main's own word for it", async () => {
  const r = rail();
  const places = (await r.call("workspaces:places")).places;
  assert.deepEqual(places.filter(place => place.makeHome).map(place => place.id), ["vps"]);
  assert.deepEqual(await r.call("workspaces:make-home", "vps"), { started: true });
  for (const id of ["box", "local", "https://box.example.test", { toString: () => "vps" }]) {
    assert.throws(() => r.call("workspaces:make-home", id), /can't be your bots' home/, String(id));
  }
  assert.deepEqual(r.made, ["vps"]);
  r.w.offered.clear();
  assert.throws(() => r.call("workspaces:make-home", "vps"), /can't be your bots' home/, "no longer offered: refused");
  r.w.lists = false;
  assert.throws(() => r.call("workspaces:make-home", "vps"), /only available/, "any other page: refused");
});

test("Remove from list on a server saved by hand: main forgets it here, by its own word for which one", async () => {
  const r = rail();
  const vps = (await r.call("workspaces:places")).places.find(place => place.id === "vps");
  assert.deepEqual([vps.removable, vps.forget], [true, true]);
  assert.deepEqual(await r.call("workspaces:remove", "vps"), { outcome: "removed" });
  for (const id of ["local", "lab"]) await assert.rejects(r.call("workspaces:remove", id), /isn't here/, id);
  assert.deepEqual(r.forgotten, ["vps"], "never this computer's own");
  assert.deepEqual(await rail({ forget: async () => false }).call("workspaces:remove", "vps"), { outcome: "failed" });
});

const PRELOAD = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8");
function preload(origin, { activation = false } = {}) {
  let bridge; const invoked = [];
  vm.runInNewContext(PRELOAD, {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`] },
    location: { origin }, navigator: { userActivation: { isActive: activation } }, TextEncoder, localStorage: { getItem: () => null }, queueMicrotask,
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { on() {}, removeListener() {}, send() {}, sendSync: () => null, invoke: (...args) => { invoked.push(args); return Promise.resolve(); } } }),
  });
  return { bridge, invoked };
}

test("a server's page gets the rail's narrow bridge; a circle and ＋ open only from the person's click", async () => {
  const page = preload(VPS);
  assert.deepEqual(Object.keys(page.bridge.workspaces), ["state", "menu", "places", "open", "add", "look", "color", "recolor", "remove", "makeHome", "onChanged"]);
  await page.bridge.workspaces.places();
  await assert.rejects(page.bridge.workspaces.open("vps"), /Choose a place/);
  await assert.rejects(page.bridge.workspaces.add("link"), /Choose what to add/);
  await assert.rejects(page.bridge.workspaces.color("rose"), /Choose a color/, "a page changes its place's colour only from the person's click");
  await assert.rejects(page.bridge.workspaces.recolor("vps", "rose"), /Choose a color/);
  await assert.rejects(page.bridge.workspaces.remove("old"), /Choose Remove from list/, "Remove from list only from the person's click");
  await assert.rejects(page.bridge.workspaces.makeHome("vps"), /Choose Make my home/, "a move starts only from the person's click");
  await page.bridge.workspaces.look();
  assert.deepEqual(page.invoked.at(-1), ["workspaces:look"]);
  const clicked = preload(VPS, { activation: true });
  await clicked.bridge.workspaces.open({ toString: () => "vps" });
  await clicked.bridge.workspaces.add("link");
  await clicked.bridge.workspaces.color("rose");
  await clicked.bridge.workspaces.color(null);
  assert.deepEqual(clicked.invoked, [["workspaces:open", "vps"], ["workspaces:add", "link"], ["workspaces:color", "rose"], ["workspaces:color", null]]);
  assert.equal(page.bridge.cloudSendPage, undefined, "never the move's bridge");
  const local = preload(LOCAL);
  await local.bridge.workspaces.open("vps");
  assert.deepEqual(local.invoked, [["workspaces:open", "vps"]], "this app's own page needs no click check");
});
