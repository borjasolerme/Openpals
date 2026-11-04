import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import environments from "./environments.cjs";
import { railPlaces } from "./cloud-rail.mjs";
import { installPlaceLook, placeLook, swatchOf } from "./place-look.mjs";

const VPS = "https://bots.example.test";
const typed = { id: "vps", kind: "remote", name: "Office", origin: VPS };

test("a place's colour is this app's: This computer, a named folder and a server connected by hand", () => {
  assert.deepEqual(placeLook(typed), { name: "Office", color: null, swatch: null });
  assert.deepEqual(placeLook({ ...typed, color: "orange" }).swatch, null, "a colour no swatch has is shown, and none of the six is ticked");
  for (const none of [null, undefined, { id: "x", kind: "remote", name: "No address" }]) assert.equal(placeLook(none), null);
  assert.deepEqual(placeLook(environments.savedPlace({ activeId: "local", environments: [] })), { name: "This computer", color: null, swatch: null },
    "This computer: plain until the person picks a colour, which this app keeps");
  assert.deepEqual(placeLook({ id: "lab", kind: "local", name: "Lab", dataDir: "/x", color: "teal" }), { name: "Lab", color: "teal", swatch: "green" },
    "a named folder on this computer has its own");
  assert.deepEqual(["blue", "teal", "yellow", "red", "purple", "orange", null, "url(x)"].map(swatchOf), ["blue", "green", "amber", "rose", "violet", null, null, null]);
});

test("main's own wiring: This computer's page reads and changes its own colour, kept with this app's saved places", async () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("installPlaceLook({ ipcMain, guard: workspaceOnly"), end = source.indexOf('ipcMain.handle("sharing:state"', start);
  assert.ok(start >= 0 && end > start, "main installs the colour's channels");
  const handlers = new Map(), persisted = [];
  const context = vm.createContext({ installPlaceLook, savedPlace: environments.savedPlace, withPlaceColor: environments.withPlaceColor,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, workspaceOnly: handler => handler,
    environmentsState: { environments: [typed], activeId: "local" },
    persistEnvironments: next => { persisted.push(next); context.environmentsState = next; },
    chromeRail: { owns: () => false }, railList: () => [] });
  vm.runInContext(source.slice(start, end), context);
  const call = (channel, ...args) => handlers.get(channel)({ sender: {} }, ...args);
  assert.deepEqual(await call("workspaces:look"), { name: "This computer", color: null, swatch: null }, "plain until a colour is picked");
  assert.deepEqual((await call("workspaces:color", "amber")).look, { name: "This computer", color: "yellow", swatch: "amber" });
  assert.deepEqual([persisted.length, context.environmentsState.localColor, context.environmentsState.environments], [1, "yellow", [typed]], "kept beside the saved places");
  assert.equal(environments.parseEnvironments(environments.serializeEnvironments(context.environmentsState)).localColor, "yellow", "and in the file");
  assert.deepEqual((await call("workspaces:color", "slate")).look.color, null, "None");
  assert.equal(Object.hasOwn(context.environmentsState, "localColor"), false);
  await assert.rejects(call("workspaces:color", "chartreuse"), /Choose one of the colors/);
});

test("the window's rail changes the colour of any place it lists; never from a page, never an unlisted place", async () => {
  const handlers = new Map(), saved = [], RAIL = { id: "rail" };
  let state = { activeId: "vps", environments: [typed] };
  const listed = () => railPlaces({ saved: state });
  installPlaceLook({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, guard: handler => handler,
    place: () => environments.savedPlace(state),
    save: (id, color) => { saved.push([id, color]); state = environments.withPlaceColor(state, id, color); },
    rail: { owns: event => event.sender === RAIL, places: listed, saved: id => environments.savedPlace(state, id) } });
  const recolor = (sender, ...args) => handlers.get("workspaces:recolor")({ sender }, ...args);
  assert.deepEqual(await recolor(RAIL, "vps", "amber"), { outcome: "saved", look: { name: "Office", color: "yellow", swatch: "amber" } });
  assert.deepEqual(listed().find(place => place.id === "vps").paint, { swatch: "amber" }, "its circle follows");
  assert.throws(() => recolor({ id: "page" }, "vps", "rose"), /only available to the window's rail/, "no place's page, not even this computer's");
  await assert.rejects(recolor(RAIL, "somewhere", "rose"), /isn't here/);
  await assert.rejects(recolor(RAIL, "vps", "chartreuse"), /Choose one of the colors/);
  assert.deepEqual(listed()[0], { id: "local", name: "This computer", color: null, kind: "computer", opens: true, paint: { swatch: null } }, "This computer's circle: plain, with a menu");
  assert.deepEqual(await recolor(RAIL, "local", "violet"), { outcome: "saved", look: { name: "This computer", color: "purple", swatch: "violet" } });
  assert.deepEqual([saved.at(-1), state.localColor], [["local", "purple"], "purple"]);
});

test("a saved place's colour: set, cleared to none, an unknown one ignored", () => {
  const state = { activeId: "vps", environments: [typed, { id: "lab", kind: "local", name: "Lab", dataDir: "/x" }] };
  const red = environments.withPlaceColor(state, "vps", "red");
  assert.equal(red.environments.find(entry => entry.id === "vps").color, "red");
  assert.equal(environments.withPlaceColor(red, "vps", "red"), red, "the same state when nothing changes");
  assert.equal(Object.hasOwn(environments.withPlaceColor(red, "vps", null).environments.find(entry => entry.id === "vps"), "color"), false);
  for (const [id, color] of [["vps", "chartreuse"], ["local", "url(x)"], ["lab", "teal;"], ["gone", "red"]]) assert.equal(environments.withPlaceColor(state, id, color), state, `${id} ${color}`);
});

test("This computer's colour: none in a file written before there was one, kept beside the saved places once picked, cleared by None, and kept when a server is forgotten", () => {
  const before = environments.parseEnvironments(JSON.stringify({ version: 2, environments: [typed], activeId: "local" }));
  assert.deepEqual([environments.savedPlace(before).color, Object.hasOwn(before, "localColor")], [undefined, false], "someone updating sees no change: plain");
  const teal = environments.withPlaceColor(before, "local", "teal");
  assert.deepEqual([teal.localColor, teal.environments], ["teal", before.environments], "no saved place is made for it");
  assert.equal(environments.withPlaceColor(teal, "local", "teal"), teal, "the same state when nothing changes");
  const written = environments.serializeEnvironments(teal);
  assert.equal(JSON.parse(written).localColor, "teal");
  assert.deepEqual(environments.parseEnvironments(written), teal, "read back after a restart");
  const none = environments.withPlaceColor(teal, "local", null);
  assert.deepEqual([Object.hasOwn(none, "localColor"), Object.hasOwn(JSON.parse(environments.serializeEnvironments(none)), "localColor")], [false, false], "None: plain again, and nothing left in the file");
  assert.equal(environments.withoutEnvironment(teal, "vps").localColor, "teal", "forgetting a server keeps it");
  assert.equal(environments.parseEnvironments(JSON.stringify({ version: 2, environments: [], activeId: "local", localColor: "url(x)" })).localColor, undefined,
    "a colour this app doesn't draw is never read");
  const lab = environments.withPlaceColor({ ...teal, environments: [...teal.environments, { id: "lab", kind: "local", name: "Lab", dataDir: "/x" }] }, "lab", "purple");
  assert.deepEqual([environments.savedPlace(lab, "lab").color, lab.localColor], ["purple", "teal"], "a named folder on this computer keeps a colour of its own");
  assert.equal(environments.parseEnvironments(environments.serializeEnvironments(lab)).environments.find(entry => entry.id === "lab").color, "purple");
});
