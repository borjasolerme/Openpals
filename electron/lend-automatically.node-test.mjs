// This computer works for the server that is the person's bots' home by itself: what it lends, Pause, the move's project
// folders, the protections that still hold through the home folder, the menu-bar item and its activity window.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { automaticGrant, createComputerSharing, lendsAsWanted } from "./computer-sharing.mjs";
import { activityPage, createActivityWindow } from "./lending-activity-window.mjs";
import { createLendingIndicator, indicatorText } from "./lending-indicator.mjs";
import { createLendingTarget } from "./lending-target.mjs";
import { WORDS } from "./lending-words.mjs";

const HOME = "https://garage.example.test", OTHER = "https://office.example.test";
const garage = { id: "garage", kind: "remote", name: "Garage server", origin: HOME };
const office = { id: "office", kind: "remote", name: "Office server", origin: OTHER };

const until = async (check, what, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return; await delay(10); }
  assert.fail(`timed out waiting for ${what}`);
};

async function scratch(t) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "omb-lend-automatically-")));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return dir;
}

/** A server of the person's own as the poll sees it: what this computer registered, each job's result, and its disconnects. */
function cloudHome({ link = true, chrome = true } = {}) {
  const json = (value, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, body: (async function* () { yield Buffer.from(JSON.stringify(value)); })() });
  const state = { environmentId: randomUUID(), sessionId: randomUUID(), connects: [], results: [], queue: [], disconnects: [], calls: 0 };
  state.push = operation => state.queue.push({ id: randomUUID(), operation: { computer_id: state.connects.at(-1).id, ...operation } });
  state.fetch = async (url, init) => {
    state.calls++;
    const route = new URL(url).pathname;
    if (route === "/api/auth/session") return json({ kind: "session", id: state.sessionId, scopes: ["admin", "client"], own: true });
    if (route === "/.well-known/openmausbot/environment") return json({ environmentId: state.environmentId, capabilities: { sharedComputers: true, lendingDetails: true, ...(link ? { deviceLink: true } : {}), ...(chrome ? { myChromeLink: true } : {}) } });
    const body = init?.body ? JSON.parse(init.body) : {};
    if (route === "/api/shared-computers/connect") { state.connects.push(body); return json({ ok: true }); }
    if (route.endsWith("/poll")) {
      const job = state.queue.shift() ?? null;
      if (!job) await delay(50, undefined, { signal: init?.signal }).catch(() => {});
      init?.signal?.throwIfAborted();
      return json({ job });
    }
    if (route.endsWith("/lease")) return json({ active: true });
    if (route.endsWith("/result")) { state.results.push(body.result); return json({ ok: true }); }
    if (route.endsWith("/disconnect")) { state.disconnects.push(body); return json({ ok: true }); }
    return json({ ok: true });
  };
  return state;
}

/** This computer lending to every saved place the way main wires it: the server that is home (the first place, while
 * `atHome`), its home folder, and apps and screen while `screen` says so. */
async function computer(t, { places = [garage], screen = () => false, home, homes = {}, cuaConnection = async () => null, askForScreen, ownHome } = {}) {
  const dir = await scratch(t);
  const file = path.join(dir, "profile", "computer-sharing.json");
  const signedIn = { atHome: true };
  const target = createLendingTarget({ environments: () => places,
    ownHome: ownHome ?? (() => (signedIn.atHome ? { origin: places[0].origin, environmentId: homes[places[0].origin].environmentId } : null)) });
  const summaries = [];
  const dials = [];
  const make = () => createComputerSharing({
    file, environments: () => places, enabled: async () => false, home: home ?? path.join(dir, "home"),
    fetch: (url, init) => {
      const at = homes[new URL(url).origin];
      if (!at) throw new Error(`no Cloud at ${new URL(url).origin}`);
      return at.fetch(url, init);
    },
    cloud: target.cloud, homeServer: target.environment, ownClouds: target.places, screen, cuaConnection, ...(askForScreen ? { askForScreen } : {}),
    hostControl: async () => ({ renew: async () => {}, release: async () => {} }), onChange: summary => summaries.push(summary),
    WebSocket: class { constructor(url) { dials.push(url); } close() {} send() {} },
  });
  let sharing = make();
  t.after(() => sharing.close());
  return { dir, file, target, summaries, dials, signedIn, get sharing() { return sharing; }, restart: () => { sharing.close(); sharing = make(); return sharing; } };
}

test("the bots' home is lent this computer by itself: the internet connection, their Chrome and the home folder with editing; not the terminal unless turned on", async t => {
  const homes = { [HOME]: cloudHome(), [OTHER]: cloudHome() };
  const dir = await scratch(t);
  const home = path.join(dir, "me");
  await mkdir(home);
  t.mock.method(os, "homedir", () => home);
  const mac = await computer(t, { homes, home, places: [garage, office] });
  mac.sharing.start();
  await until(() => homes[HOME].connects.length === 1, "the home to be lent this computer, with no click");
  const [lent] = homes[HOME].connects;
  assert.deepEqual({ folders: lent.folders.map(folder => [folder.name, folder.write]), internet: lent.internet, chrome: lent.chrome, terminal: lent.terminal, computer: lent.computer },
    { folders: [["me", true]], internet: true, chrome: true, terminal: false, computer: false });
  const kept = JSON.parse(await readFile(mac.file, "utf8")).records[garage.id];
  assert.deepEqual({ home: kept.folders[0].home, path: kept.folders[0].path, write: kept.folders[0].write }, { home: true, path: home, write: true });
  assert.deepEqual(mac.summaries.at(-1).clouds, ["Garage server"]);
  await delay(100);
  assert.equal(homes[OTHER].calls, 0, "a server connected by hand that is not home is never called");
});

test("a server of the person's own their bots moved to is lent only while it is home, says it is theirs alone and is the server the move chose", async t => {
  const GARAGE = HOME;
  const server = cloudHome({ link: false, chrome: false });
  const answer = server.fetch;
  let own = true;
  server.fetch = async (url, init) => (new URL(url).pathname === "/api/auth/session"
    ? { ok: true, status: 200, headers: { get: () => null }, body: (async function* () { yield Buffer.from(JSON.stringify({ kind: "session", id: server.sessionId, scopes: ["admin", "client"], ...(own ? { own: true } : {}) })); })() }
    : answer(url, init));
  let home = null;
  const mac = await computer(t, { homes: { [GARAGE]: server }, places: [garage], ownHome: () => home });
  mac.sharing.start();
  await delay(100);
  assert.equal(server.connects.length, 0, "connected by hand and not home: never lent by itself");
  home = { origin: GARAGE, environmentId: server.environmentId };
  mac.sharing.cloudChanged();
  await until(() => server.connects.length === 1, "Garage server to be lent this computer, with no click");
  assert.equal(server.connects[0].terminal, false);
  assert.deepEqual(mac.summaries.at(-1).clouds, ["Garage server"], "the menu bar says who can use this computer");
  mac.sharing.pause();
  assert.equal(mac.summaries.at(-1).paused, true);
  await mac.sharing.resume();
  await until(() => server.connects.length === 2, "lent again on Resume");

  own = false;
  const strangers = mac.restart();
  strangers.start();
  await delay(150);
  assert.equal(server.connects.length, 2, "a server with other people on it now is never lent");
  assert.match(strangers.state(garage.id).error ?? "", /not your bots' home any more/u);

  own = true;
  const chosen = { origin: GARAGE, environmentId: randomUUID() };
  const elsewhere = await computer(t, { homes: { [GARAGE]: server }, places: [garage], ownHome: () => chosen });
  elsewhere.sharing.start();
  await until(() => elsewhere.sharing.state(garage.id).error, "the lending to be refused");
  assert.equal(server.connects.length, 2, "another server behind the same address than the one the move chose is never lent");
  assert.match(elsewhere.sharing.state(garage.id).error, /not your bots' home any more/u);
});

test("apps and screen are lent once computer control works here, and follow it", async t => {
  const homes = { [HOME]: cloudHome() };
  let works = false;
  const mac = await computer(t, { homes, places: [garage], screen: () => works });
  mac.sharing.start();
  await until(() => homes[HOME].connects.length === 1, "lending to start");
  assert.equal(homes[HOME].connects[0].computer, false, "not before macOS has granted its permissions");
  works = true;
  await mac.sharing.screenChanged();
  await until(() => homes[HOME].connects.length === 2, "apps and screen to be lent");
  assert.equal(homes[HOME].connects[1].computer, true);
  await mac.sharing.screenChanged();
  await delay(100);
  assert.equal(homes[HOME].connects.length, 2, "nothing is lent again while nothing changed");
  works = false;
  await mac.sharing.screenChanged();
  await until(() => homes[HOME].connects.length === 3, "apps and screen to be taken back");
  assert.equal(homes[HOME].connects[2].computer, false);
});

test("a server that is no longer home stops being lent; home there again lends again by itself", async t => {
  const homes = { [HOME]: cloudHome() };
  const mac = await computer(t, { homes });
  mac.sharing.start();
  await until(() => homes[HOME].connects.length === 1, "lending to start");
  mac.signedIn.atHome = false;
  mac.sharing.cloudChanged();
  assert.equal(mac.sharing.state(garage.id).enabled, false);
  assert.deepEqual(mac.summaries.at(-1).clouds, [], "nothing in the menu bar while nothing is home");
  mac.signedIn.atHome = true;
  mac.sharing.cloudChanged();
  await until(() => homes[HOME].connects.length === 2, "lending to come back by itself");
});

test("Pause stops the home at once and lasts across restarts; Resume lends again", async t => {
  const homes = { [HOME]: cloudHome() };
  const mac = await computer(t, { homes });
  mac.sharing.start();
  await until(() => homes[HOME].connects.length === 1, "the home to be lent");
  mac.sharing.pause();
  await until(() => homes[HOME].disconnects.length === 1, "the home to be told");
  assert.deepEqual(mac.summaries.at(-1), { lending: [], clouds: ["Garage server"], using: [], paused: true, terminal: false, busy: null, screen: null });
  homes[HOME].push({ action: "list_files", folder_id: randomUUID() });
  const again = mac.restart();
  again.start();
  again.cloudChanged();
  await delay(300);
  assert.deepEqual([homes[HOME].connects.length, homes[HOME].results.length], [1, 0], "nothing runs while paused, after a restart too");
  assert.equal(again.paused(), true);
  await again.resume();
  await until(() => homes[HOME].connects.length === 2, "Resume to lend again");
  assert.equal(mac.restart().paused(), false);
});

test("someone who had switched lending off, or unticked the internet connection, starts Paused; anyone else is lent by itself", async t => {
  const record = extra => ({ sessionId: null, environmentId: null, id: randomUUID(), secret: "a".repeat(64), folders: [], terminal: false, computer: false,
    cloud: { accountId: "own:fixture", origin: HOME }, ...extra });
  const cases = [
    ["their own Off", record({ enabled: false, internet: true, stopped: { reason: "you", at: 1 } }), true],
    ["an Off kept from before its reason was", record({ enabled: false, internet: true }), true],
    ["the internet connection unticked", record({ enabled: true, internet: false }), true],
    ["a sign-out stopped it", record({ enabled: false, internet: true, stopped: { reason: "signed-out", at: 1 } }), false],
    ["lending on", record({ enabled: true, internet: true }), false],
    ["nothing kept", null, false],
  ];
  for (const [what, kept, paused] of cases) {
    const homes = { [HOME]: cloudHome() };
    const mac = await computer(t, { homes });
    await mkdir(path.dirname(mac.file), { recursive: true });
    await writeFile(mac.file, JSON.stringify({ version: 1, records: kept ? { [garage.id]: kept } : {} }));
    const sharing = mac.restart();
    sharing.start();
    if (paused) {
      await delay(200);
      assert.equal(sharing.paused(), true, what);
      assert.equal(homes[HOME].connects.length, 0, `${what}: nothing lent`);
      assert.deepEqual({ paused: mac.summaries.at(-1)?.paused, clouds: mac.summaries.at(-1)?.clouds }, { paused: true, clouds: ["Garage server"] }, `${what}: the menu bar says Paused, with Resume`);
    } else {
      await until(() => homes[HOME].connects.at(-1)?.internet === true, `${what}: lent by itself`);
      assert.equal(sharing.paused(), false, what);
    }
  }
});

test("a grant kept from before keeps its folders, and the terminal its home lent, as the menu's switch", async t => {
  const homes = { [HOME]: cloudHome() };
  const mac = await computer(t, { homes });
  const plans = path.join(mac.dir, "Plans");
  await mkdir(plans);
  const id = randomUUID();
  await mkdir(path.dirname(mac.file), { recursive: true });
  await writeFile(mac.file, JSON.stringify({ version: 1, records: { [garage.id]: { sessionId: null, environmentId: null, id: randomUUID(), secret: "a".repeat(64), enabled: true,
    folders: [{ id, path: plans, name: "Plans", write: false }], terminal: true, computer: false, internet: true, cloud: { accountId: `own:${homes[HOME].environmentId}`, origin: HOME } } } }));
  const sharing = mac.restart();
  sharing.start();
  await until(() => homes[HOME].connects.length === 1, "the automatic grant to reach the home");
  await delay(100);
  assert.equal(homes[HOME].connects.length, 1, "the grant from before never connected, not even for a moment");
  assert.deepEqual(homes[HOME].connects[0].folders.map(folder => [folder.id, folder.name, folder.write]), [[id, "Plans", false]], "the same folder, by the same id");
  assert.equal(homes[HOME].connects[0].terminal, true);
  assert.equal(mac.summaries.at(-1).terminal, true, "the menu shows it on");
  homes[HOME].push({ action: "run_command", command: "echo kept" });
  await until(() => homes[HOME].results.length === 1, "the command's answer");
  assert.notEqual(homes[HOME].results[0].isError, true, "the command ran here");
  const again = mac.restart();
  again.start();
  await until(() => homes[HOME].connects.length === 2, "the kept grant to reach the home after another restart");
  assert.equal(homes[HOME].connects[1].terminal, true, "still lent once saved the new way");
});

test("grants from before give no terminal when one didn't lend it or the person said no to lending, after Resume too", async t => {
  const grant = (origin, extra) => ({ sessionId: null, environmentId: null, id: randomUUID(), secret: "a".repeat(64), enabled: true, folders: [], terminal: true,
    computer: false, internet: true, cloud: { accountId: "own:fixture", origin }, ...extra });
  const cases = {
    "it didn't lend the terminal": { [garage.id]: grant(HOME, { terminal: false }) },
    "it is off": { [garage.id]: grant(HOME, { enabled: false }) },
    "the internet connection was unticked": { [garage.id]: grant(HOME, { internet: false }) },
  };
  for (const [why, records] of Object.entries(cases)) {
    const homes = { [HOME]: cloudHome() };
    const mac = await computer(t, { homes });
    await mkdir(path.dirname(mac.file), { recursive: true });
    await writeFile(mac.file, JSON.stringify({ version: 1, records }));
    const sharing = mac.restart();
    sharing.start();
    if (sharing.paused()) await sharing.resume();
    await until(() => homes[HOME].connects.length === 1, `the automatic grant to reach the home when ${why}`);
    assert.equal(homes[HOME].connects[0].terminal, false, why);
    assert.equal(mac.summaries.at(-1).terminal, false, why);
  }
});

test("the terminal is lent only once the person turns it on: every own Cloud gets it, it lasts across restarts, and turning it off takes it back", async t => {
  const homes = { [HOME]: cloudHome() };
  const mac = await computer(t, { homes, places: [garage] });
  mac.sharing.start();
  await until(() => homes[HOME].connects.length === 1, "the automatic grant to reach the home");
  assert.equal(homes[HOME].connects[0].terminal, false, "off by default");
  assert.equal(mac.summaries.at(-1).terminal, false);
  await mac.sharing.lendTerminal(true);
  await until(() => homes[HOME].connects.length === 2, "the grant with the terminal to reach the home");
  assert.equal(homes[HOME].connects[1].terminal, true);
  assert.equal(mac.summaries.at(-1).terminal, true);
  homes[HOME].push({ action: "run_command", command: "echo lent" });
  await until(() => homes[HOME].results.length === 1, "the command's answer");
  assert.notEqual(homes[HOME].results[0].isError, true, "the command ran here");
  const restarted = mac.restart();
  restarted.start();
  await until(() => homes[HOME].connects.length === 3, "the kept grant to reach the home after a restart");
  assert.equal(homes[HOME].connects[2].terminal, true, "still lent after a restart");
  await restarted.lendTerminal(false);
  await until(() => homes[HOME].connects.length === 4, "the grant without the terminal to reach the home");
  assert.equal(homes[HOME].connects[3].terminal, false);
});

test("a terminal choice that can't be saved is not kept, so nothing lends it later", async t => {
  const homes = { [HOME]: cloudHome() };
  const mac = await computer(t, { homes, places: [garage] });
  mac.sharing.start();
  await until(() => homes[HOME].connects.length === 1, "the automatic grant to reach the home");
  // A folder where the file goes makes the save's rename fail on every platform.
  await rm(mac.file);
  await mkdir(mac.file);
  assert.throws(() => mac.sharing.lendTerminal(true));
  await rm(mac.file, { recursive: true });
  await mac.sharing.screenChanged();
  await delay(100);
  assert.equal(homes[HOME].connects.length, 1, "no grant with the terminal reached My Cloud");
  assert.equal(mac.summaries.at(-1).terminal, false);
});

test("the automatic grant, piece by piece: the home folder first with editing, folders kept as they were, project folders with editing, at most 20", () => {
  const folder = (name, write = false, extra = {}) => ({ id: randomUUID(), path: `/Users/me/${name}`, name, write, ...extra });
  const home = { id: randomUUID(), path: "/Users/me", name: "me", write: true, home: true };
  const kept = Array.from({ length: 20 }, (_, n) => folder(`Kept ${n}`));
  const wanted = automaticGrant({ kept, home, screen: true, projects: [folder("Kept 0", true), folder("App", true)] });
  assert.equal(wanted.folders.length, 20);
  assert.deepEqual(wanted.folders[0], home);
  assert.equal(wanted.folders[1].write, true, "a kept folder the move lends with editing keeps it");
  assert.deepEqual({ screen: wanted.screen, internet: wanted.internet, chrome: wanted.chrome, terminal: wanted.terminal }, { screen: true, internet: true, chrome: true, terminal: false });
  const keptHome = { ...home, id: "kept-home-id", write: false };
  assert.deepEqual(automaticGrant({ kept: [keptHome], home }).folders, [{ ...keptHome, write: true }], "the home folder kept before keeps its id and gains editing");
  assert.deepEqual(automaticGrant({}).folders, [], "no home folder where it can't be lent");
  const record = { enabled: true, cloud: { accountId: "a", origin: HOME }, folders: wanted.folders, internet: true, chrome: true, computer: true, terminal: false };
  assert.equal(lendsAsWanted(record, wanted), true);
  assert.equal(automaticGrant({ terminal: true }).terminal, true, "the terminal only when the person turned it on");
  assert.equal(lendsAsWanted({ ...record, terminal: true }, { ...wanted, terminal: true }), true);
  for (const changed of [{ terminal: true }, { chrome: false }, { internet: false }, { computer: false }, { enabled: false }, { cloud: undefined }, { folders: wanted.folders.slice(1) }]) {
    assert.equal(lendsAsWanted({ ...record, ...changed }, wanted), false, JSON.stringify(Object.keys(changed)));
  }
});

test("through the home folder, keys, passwords, sign-ins and git secrets stay private and its settings can't be changed; other files can be edited", async t => {
  const dir = await scratch(t);
  const home = path.join(dir, "me");
  const put = async (relative, text) => { await mkdir(path.dirname(path.join(home, relative)), { recursive: true }); await writeFile(path.join(home, relative), text); };
  await put(".ssh/id_ed25519", "PRIVATE KEY");
  await put(".zshrc", "export OPENAI_API_KEY=sk-fixture");
  await put(".gitconfig", "[credential]\n\thelper = store");
  await put(".git-credentials", "https://me:token@github.com");
  await put(".config/gh/hosts.yml", "oauth_token: gho_fixture");
  await put("Library/Application Support/App/settings.json", "{}");
  await put("Documents/notes.md", "my notes");
  t.mock.method(os, "homedir", () => home);
  const homes = { [HOME]: cloudHome() };
  const mac = await computer(t, { homes, home, places: [garage] });
  mac.sharing.start();
  await until(() => homes[HOME].connects.length === 1, "lending to start");
  const folder = homes[HOME].connects[0].folders[0].id;
  const jobs = [
    ["read_file", ".ssh/id_ed25519"], ["read_file", ".zshrc"], ["read_file", ".gitconfig"], ["read_file", ".git-credentials"], ["read_file", ".config/gh/hosts.yml"],
    ["write_file", ".zprofile"], ["write_file", ".config/autostart/run.desktop"], ["write_file", "Library/LaunchAgents/run.plist"], ["write_file", "library/Application Support/App/settings.json"],
    ["read_file", "Documents/notes.md"], ["write_file", "Documents/plan.md"], ["list_files", ""],
  ];
  for (const [action, where] of jobs) homes[HOME].push({ action, folder_id: folder, path: where, ...(action === "write_file" ? { content: "from the home" } : {}) });
  await until(() => homes[HOME].results.length === jobs.length, "every answer", 10_000);
  const answers = homes[HOME].results.map(result => result.content[0].text);
  for (const [index, [action, where]] of jobs.slice(0, 9).entries()) {
    assert.equal(homes[HOME].results[index].isError, true, `${action} ${where}`);
    assert.doesNotMatch(answers[index], /sk-fixture|PRIVATE KEY|token|gho_/, `${where}: nothing private in the answer`);
  }
  assert.match(answers[5], /hidden files, Library and AppData/);
  assert.match(answers[7], /hidden files, Library and AppData/);
  assert.equal(JSON.parse(answers[9]).content, "my notes");
  assert.equal(JSON.parse(answers[10]).written, true);
  assert.equal(await readFile(path.join(home, "Documents", "plan.md"), "utf8"), "from the home");
  const listed = Object.fromEntries(JSON.parse(answers[11]).entries.map(entry => [entry.name, entry.type]));
  assert.deepEqual([listed[".ssh"], listed[".zshrc"], listed[".gitconfig"], listed.Documents], ["protected", "protected", "protected", "directory"]);
  await assert.rejects(readFile(path.join(home, ".zprofile")), { code: "ENOENT" });
  assert.deepEqual(await readdir(path.join(home, "Library")), ["Application Support"]);
});

test("a Cloud's bot needing apps and screen on a Mac that lacks only macOS's permissions asks macOS for them, and says how to allow them", async t => {
  const homes = { [HOME]: cloudHome() };
  const asked = [];
  const missing = { mode: "unavailable", reason: "Error: Accessibility and Screen Recording required; grant access in System Settings and restart Openpals" };
  const mac = await computer(t, { homes, places: [garage], screen: () => true, cuaConnection: async () => missing, askForScreen: connection => asked.push(connection) });
  mac.sharing.start();
  await until(() => homes[HOME].connects.length === 1, "lending to start");
  assert.equal(homes[HOME].connects[0].computer, true, "lent, so the first bot to need it can have macOS ask");
  homes[HOME].push({ action: "computer_tools" });
  await until(() => homes[HOME].results.length === 1, "the answer");
  assert.deepEqual(asked, [missing]);
  assert.match(homes[HOME].results[0].content[0].text, /allow Accessibility and Screen Recording for Openpals in System Settings/);
});

test("the move's project folders are lent to the home with editing on top; while paused the move is told to try later", async t => {
  const homes = { [HOME]: cloudHome() };
  const mac = await computer(t, { homes });
  const app = path.join(mac.dir, "App");
  await mkdir(app);
  mac.sharing.start();
  await until(() => homes[HOME].connects.length === 1, "lending to start");
  await mac.sharing.lendProjects([app, path.join(mac.dir, "Gone")]);
  await until(() => homes[HOME].connects.length === 2, "the projects to reach the home");
  assert.deepEqual(homes[HOME].connects[1].folders.map(folder => [folder.name, folder.write]), [["App", true]]);
  mac.sharing.pause();
  await assert.rejects(mac.sharing.lendProjects([app]), /waits/);
});

test("the menu-bar item: which servers are using this Mac, Pause or Resume, the terminal switch and See activity", () => {
  const trays = [];
  class Tray {
    constructor() { this.destroyed = false; trays.push(this); }
    on() {} setToolTip(value) { this.tip = value; } setTitle(value) { this.title = value; }
    setContextMenu(menu) { this.menu = menu; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  }
  const clicked = [];
  const turned = [];
  const indicator = createLendingIndicator({ Tray, Menu: { buildFromTemplate: items => items }, nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, iconPath: "icon.png",
    onPause: () => clicked.push("pause"), onResume: () => clicked.push("resume"), onActivity: () => clicked.push("activity"), onTerminal: on => turned.push(on), device: "Mac" });
  const labels = () => trays.at(-1).menu.map(item => item.type === "separator" ? "-" : item.label);
  indicator.update({ clouds: [], using: [], paused: false });
  assert.equal(trays.length, 0, "nothing in the menu bar without a home server");
  indicator.update({ clouds: ["My Cloud", "Client A"], using: [], paused: false });
  assert.deepEqual(labels(), ["My Cloud and Client A can use this Mac", "-", "Pause", "Let your server run commands on this Mac", "See activity"]);
  assert.equal(trays[0].title, "");
  indicator.update({ clouds: ["My Cloud", "Client A"], using: ["Client A"], paused: false });
  assert.equal(trays.length, 1);
  assert.deepEqual(labels(), ["Client A is using this Mac", "-", "Pause", "Let your server run commands on this Mac", "See activity"]);
  assert.equal(trays[0].title, "Client A is using this Mac");
  assert.equal(trays[0].tip, "Openpals: Client A is using this Mac");
  trays[0].menu.find(item => item.label === "Pause").click();
  trays[0].menu.find(item => item.label === "See activity").click();
  indicator.update({ clouds: ["My Cloud"], using: [], paused: true });
  assert.deepEqual(labels(), ["Paused: My Cloud can't use this Mac", "-", "Resume", "See activity"]);
  assert.equal(trays[0].title, "Paused");
  trays[0].menu.find(item => item.label === "Resume").click();
  assert.deepEqual(clicked, ["pause", "activity", "resume"]);
  indicator.update({ clouds: ["My Cloud"], using: [], paused: false, terminal: true });
  const terminal = () => trays[0].menu.find(item => item.label === "Let your server run commands on this Mac");
  assert.equal(terminal().checked, true);
  terminal().click();
  indicator.update({ clouds: ["My Cloud"], using: [], paused: false, terminal: false });
  assert.equal(terminal().checked, false);
  terminal().click();
  assert.deepEqual(turned, [false, true]);
  terminal().checked = true;
  terminal().click();
  assert.equal(terminal().checked, false, "a click the person cancels leaves the box as it was");
  indicator.update({ clouds: [], using: [], paused: true });
  assert.equal(trays[0].destroyed, true, "gone once there is nothing to resume");
  assert.deepEqual(indicatorText({ clouds: ["A", "B", "C"], using: ["A", "B", "C"], paused: false }, "PC"),
    { line: "A, B and C are using this PC", title: "3 servers are using this PC", screen: null });
});

test("See activity shows this computer's own record in the app's language: every value escaped, no script, nothing loaded", async () => {
  const entries = [
    { at: Date.UTC(2026, 9, 28, 14, 2), server: "Client <A>", origin: OTHER, action: "read_file", detail: "Notes/<img src=x onerror=alert(1)>.md", ok: true },
    { at: Date.UTC(2026, 9, 28, 14, 3), server: "My Cloud", origin: HOME, action: "run_command", detail: "rm -rf ~", ok: false, error: "Terminal access is not enabled for this server" },
  ];
  const page = activityPage(entries, "de");
  assert.doesNotMatch(page, /<script|<img/i);
  assert.match(page, /Notes\/&lt;img src=x onerror=alert\(1\)&gt;\.md/);
  assert.match(page, /Client &lt;A&gt;/);
  assert.match(page, /default-src 'none'/);
  assert.match(page, new RegExp(WORDS.de["lending.action.readFile"]));
  assert.match(page, /class="refused"/);
  assert.match(activityPage([], "en"), new RegExp(WORDS.en["lending.activity.empty"].replace(/[.]/g, "\\.")));
  const windows = [];
  class BrowserWindow {
    constructor(options) { this.options = options; this.loaded = []; this.handlers = {}; this.destroyed = false; this.webContents = { setWindowOpenHandler: handler => { this.opener = handler; }, on: (event, handler) => { this.handlers[event] = handler; } }; windows.push(this); }
    once() {} on() {} show() { this.shown = true; } focus() {} isDestroyed() { return this.destroyed; } close() { this.destroyed = true; }
    loadURL(url) { this.loaded.push(url); return Promise.resolve(); }
  }
  const activity = createActivityWindow({ BrowserWindow, icon: "icon.png", background: () => "#000", entries: () => entries, locale: () => "en" });
  activity.show();
  activity.show();
  assert.equal(windows.length, 1, "one window at a time");
  const [win] = windows;
  assert.deepEqual({ javascript: win.options.webPreferences.javascript, sandbox: win.options.webPreferences.sandbox, node: win.options.webPreferences.nodeIntegration },
    { javascript: false, sandbox: true, node: false });
  assert.equal(win.loaded.length, 2, "opening it again shows what was recorded since");
  assert.ok(win.loaded.every(url => url.startsWith("data:text/html;charset=utf-8,")));
  assert.deepEqual(win.opener(), { action: "deny" });
  let prevented = false;
  win.handlers["will-navigate"]({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test("the activity window says what every language pack says, word for word", async () => {
  const dir = fileURLToPath(new URL("../src/locales/", import.meta.url));
  const en = JSON.parse(await readFile(path.join(dir, "en.json"), "utf8"));
  const keys = Object.keys(en).filter(key => key.startsWith("lending.activity.") || key.startsWith("lending.action."));
  assert.deepEqual(keys.sort(), Object.keys(WORDS.en).sort(), "every key main uses is in the catalog, and only those");
  for (const file of (await readdir(dir)).filter(name => name.endsWith(".json") && name !== "source-hashes.json")) {
    const locale = file.slice(0, -".json".length);
    const pack = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    assert.ok(WORDS[locale], `${locale}: main has no words for it`);
    for (const key of keys) assert.equal(WORDS[locale][key], pack[key] ?? en[key], `${locale} ${key}: copy src/locales/${file} into electron/lending-words.mjs`);
  }
});
