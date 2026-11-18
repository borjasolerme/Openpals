import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createComputerSharing, parseLendingRecord, parseLendLink } from "./computer-sharing.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const CODE = "ABCD-EFGH-JKLM";

/** Servers that answer lending as the real one does, each recording what it was told and by which credential. */
function fakeServers(names = { "https://boat.example": "Boat server", "https://home.example": "Ana's server" }) {
  const seen = {};
  for (const origin of Object.keys(names)) seen[origin] = { connects: [], disconnects: [], polls: 0, logouts: 0, auth: [], cookies: [], jobs: [], results: [] };
  const fetchImpl = async (url, init) => {
    const { origin, pathname: route } = new URL(url);
    const at = seen[origin];
    if (!at) throw new TypeError("fetch failed");
    at.auth.push(init?.headers?.authorization ?? null);
    at.cookies.push(init?.credentials ?? null);
    if (route === "/.well-known/openmausbot/environment") return json({ environmentId: "6f1c1f7e-2c55-4a4f-9a51-0c1c7d6f0a11", label: names[origin], capabilities: {} });
    const body = init?.body ? JSON.parse(init.body) : {};
    if (route === "/api/auth/pair") {
      if (body.code !== CODE) return json({ error: "That pairing code has already been used or has expired." }, 400);
      return json({ token: `omb_sess_${origin.length}${randomUUID()}`, environment: { label: names[origin] } });
    }
    at.secret = init?.headers?.["x-omb-computer-secret"] ?? at.secret;
    if (route === "/api/auth/logout") { at.logouts++; return json({ ok: true }); }
    if (route === "/api/shared-computers/connect") { at.connects.push(body); return json({ ok: true }); }
    if (route.endsWith("/poll")) {
      at.polls++;
      const operation = at.jobs.shift();
      if (operation) return json({ job: { id: randomUUID(), operation: { computer_id: at.connects.at(-1).id, ...operation } } });
      await delay(20, undefined, { signal: init.signal }).catch(() => {});
      return json({ job: null });
    }
    if (route.endsWith("/lease")) return json({ active: !at.endJobs });
    if (route.endsWith("/result")) { at.results.push(body.result); return json({ ok: true }); }
    if (route.endsWith("/disconnect")) { at.disconnects.push(body); return json({ ok: true }); }
    return json({ error: "not found" }, 404);
  };
  return { seen, fetchImpl };
}

async function until(check, what) {
  for (let i = 0; i < 300; i++) { if (check()) return; await delay(10); }
  assert.fail(`timed out waiting for ${what}`);
}

async function setup(t, options) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "omb-lending-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "computer-sharing.json");
  const fake = fakeServers(options);
  const make = (extra = {}) => createComputerSharing({ file, fetch: fake.fetchImpl, computerName: () => "Borja's Mac mini", platform: "darwin", retryMs: [5], ...extra });
  return { file, fake, make };
}

const online = (sharing, serverName) => sharing.summary().targets.find(target => target.serverName === serverName)?.state === "online";

test("a link from Add a computer is recognised only with its code and lend=1, over HTTPS", () => {
  assert.deepEqual(parseLendLink(`https://boat.example/pair#code=${CODE}&lend=1`), { origin: "https://boat.example", code: CODE });
  assert.equal(parseLendLink(`https://boat.example/pair#code=${CODE}`), null, "a person's pairing link is not a lending link");
  assert.equal(parseLendLink(`http://boat.example/pair#code=${CODE}&lend=1`), null);
  assert.equal(parseLendLink(`https://boat.example/pair?code=${CODE}&lend=1`), null);
  assert.equal(parseLendLink(`https://boat.example/other#code=${CODE}&lend=1`), null);
  assert.deepEqual(parseLendLink(`http://localhost:8799/pair#code=${CODE}&lend=1`), { origin: "http://localhost:8799", code: CODE });
});

test("adding a link trades its code for a lend-only session and lends under this computer's own name, with apps and screen and nothing else", async t => {
  const { fake, make, file } = await setup(t);
  const sharing = make();
  t.after(() => sharing.close());
  const view = await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "fallback" });
  assert.equal(view.on, true);
  assert.deepEqual(view.targets.map(target => target.serverName), ["Boat server"]);
  await until(() => online(sharing, "Boat server"), "online");
  const [registration] = fake.seen["https://boat.example"].connects;
  assert.deepEqual({ name: registration.name, platform: registration.platform, computer: registration.computer, terminal: registration.terminal, folders: registration.folders, screenReady: registration.screenReady },
    { name: "Borja's Mac mini", platform: "darwin", computer: true, terminal: false, folders: [], screenReady: false });
  const used = fake.seen["https://boat.example"];
  assert.ok(used.auth.filter(Boolean).every(header => header.startsWith("Bearer omb_sess_")), "every call carries the lend session, never cookies");
  assert.ok(used.cookies.every(credentials => credentials !== "include"));
  assert.match(used.secret, /^[a-f0-9]{64}$/);
  const saved = parseLendingRecord(JSON.parse(await readFile(file, "utf8")));
  assert.equal(saved.targets[0].origin, "https://boat.example");
  assert.equal(registration.id, saved.targets[0].id);
});

test("a used or expired code adds nothing", async t => {
  const { make } = await setup(t);
  const sharing = make();
  t.after(() => sharing.close());
  await assert.rejects(sharing.addTarget({ origin: "https://boat.example", code: "ZZZZ-ZZZZ-ZZZZ" }, { serverName: "Boat" }), /already been used or has expired/);
  assert.deepEqual(sharing.summary().targets, []);
  assert.equal(sharing.summary().on, false);
});

test("several servers at once: each with its own session and secret, paused, resumed and removed on its own", async t => {
  const { fake, make } = await setup(t);
  const sharing = make();
  t.after(() => sharing.close());
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  await sharing.addTarget({ origin: "https://home.example", code: CODE }, { serverName: "Home" });
  await until(() => online(sharing, "Boat server") && online(sharing, "Ana's server"), "both online");
  const boat = fake.seen["https://boat.example"], home = fake.seen["https://home.example"];
  assert.notEqual(boat.secret, home.secret);
  assert.notEqual(boat.auth.at(-1), home.auth.at(-1));
  assert.equal(sharing.summary().server, "Boat server, Ana's server");

  const homeId = sharing.summary().targets.find(target => target.serverName === "Ana's server").id;
  await sharing.pauseTarget(homeId);
  assert.deepEqual(home.disconnects.at(-1), { paused: true });
  const polls = home.polls;
  await delay(60);
  assert.equal(home.polls, polls, "a paused server is not polled");
  assert.equal(online(sharing, "Boat server"), true, "the other server keeps going");
  sharing.resumeTarget(homeId);
  await until(() => online(sharing, "Ana's server"), "resumed");

  await sharing.removeTarget(homeId);
  assert.deepEqual(home.disconnects.at(-1), {});
  assert.equal(home.logouts, 1, "removing a server signs this computer out there");
  assert.deepEqual(sharing.summary().targets.map(target => target.serverName), ["Boat server"]);
});

test("the same server's link again replaces its old session; Stop stops everywhere and Turn on lends to all again", async t => {
  const { fake, make } = await setup(t);
  const sharing = make();
  t.after(() => sharing.close());
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  await until(() => online(sharing, "Boat server"), "online");
  const first = sharing.summary().targets[0].id;
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  assert.equal(sharing.summary().targets.length, 1);
  assert.notEqual(sharing.summary().targets[0].id, first);
  await until(() => online(sharing, "Boat server"), "online again");
  assert.equal((await sharing.turnOff()).on, false);
  assert.deepEqual(fake.seen["https://boat.example"].disconnects.at(-1), {});
  assert.equal(sharing.summary().targets[0].state, "off");
  sharing.turnOn();
  await until(() => online(sharing, "Boat server"), "on again");
});

test("lending comes back by itself after a restart; a record from another version is ignored", async t => {
  const { make, file } = await setup(t);
  const first = make();
  await first.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  first.close();
  const again = make();
  t.after(() => again.close());
  await until(() => online(again, "Boat server"), "back online");
  await writeFile(file, JSON.stringify({ version: 2, id: randomUUID(), secret: "a".repeat(64), origin: "https://boat.example", enabled: true }));
  assert.equal(parseLendingRecord(JSON.parse(await readFile(file, "utf8"))), null);
});

test("each server hears when the screen becomes usable, and a new server lends commands only once turned on again", async t => {
  const { fake, make } = await setup(t);
  let ready = false;
  const sharing = make({ screen: async () => ({ ready, lent: true, reason: ready ? null : "permissions", fix: ready ? null : "allow" }) });
  t.after(() => sharing.close());
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  await until(() => online(sharing, "Boat server"), "online");
  assert.equal(fake.seen["https://boat.example"].connects.at(-1).screenReady, false);
  ready = true;
  await sharing.readScreen();
  await until(() => fake.seen["https://boat.example"].connects.at(-1)?.screenReady === true, "registered again as ready");
  sharing.setTerminal(true);
  await until(() => fake.seen["https://boat.example"].connects.at(-1)?.terminal === true, "commands lent");
  await sharing.addTarget({ origin: "https://home.example", code: CODE }, { serverName: "Home" });
  await until(() => fake.seen["https://home.example"].connects.length > 0, "home registered");
  assert.equal(fake.seen["https://home.example"].connects.at(-1).terminal, false);
});

test("two servers' screen calls never run at once on this computer", async t => {
  const { fake, make } = await setup(t);
  let holding = 0, most = 0, taken = 0;
  const hostControl = async () => {
    holding++; taken++; most = Math.max(most, holding);
    await delay(30);
    return { renew: async () => {}, release: async () => { holding--; } };
  };
  const sharing = make({ hostControl });
  t.after(() => sharing.close());
  const call = { action: "computer_call", tool_name: "get_desktop_state", arguments: {} };
  fake.seen["https://boat.example"].jobs.push(call);
  fake.seen["https://home.example"].jobs.push(call);
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  await sharing.addTarget({ origin: "https://home.example", code: CODE }, { serverName: "Home" });
  await until(() => fake.seen["https://boat.example"].results.length && fake.seen["https://home.example"].results.length, "both answered");
  assert.equal(taken, 2);
  assert.equal(most, 1);
});

/** cua-driver's own rule, as the real one keeps it: a click acts only on a window read with get_window_state first, in the
 * same connection. Each start of the driver is counted. */
const STATEFUL_DRIVER = `
const fs = require("node:fs");
fs.appendFileSync(process.env.STARTS, "start\\n");
const read = new Set();
const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") return send(m.id, { serverInfo: { name: "cua-driver", version: "0.45.4" } });
  if (m.method !== "tools/call") return;
  const { name, arguments: args } = m.params;
  if (name === "get_window_state") { read.add(args.window_id); return send(m.id, { content: [{ type: "text", text: "Chrome: LinkedIn" }] }); }
  if (name === "click") return send(m.id, read.has(args.window_id)
    ? { content: [{ type: "text", text: "clicked" }] }
    : { isError: true, content: [{ type: "text", text: "Has not read the Chrome window: call get_window_state first" }] });
});`;

test("a click after get_window_state reaches the same computer control, even when a refused job came in between", async t => {
  const { fake, make } = await setup(t);
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "omb-driver-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const driver = path.join(dir, "driver.cjs");
  const starts = path.join(dir, "starts.txt");
  await writeFile(driver, STATEFUL_DRIVER);
  await writeFile(starts, "");
  const sharing = make({ cuaConnection: async () => ({ mcpCommand: process.execPath, mcpArgs: [driver], mcpEnv: { STARTS: starts } }) });
  t.after(() => sharing.close());
  const window = { pid: 501, window_id: 77 };
  fake.seen["https://boat.example"].jobs.push(
    { action: "computer_call", tool_name: "get_window_state", arguments: window },
    // Refused before it reaches the driver: an argument a lent screen does not take.
    { action: "computer_call", tool_name: "click", arguments: { ...window, x: 10, y: 10, path: "/etc" } },
    { action: "computer_call", tool_name: "click", arguments: { ...window, x: 10, y: 10, delivery_mode: "foreground" } },
  );
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  await until(() => fake.seen["https://boat.example"].results.length === 3, "three answers");
  const [state, refused, clicked] = fake.seen["https://boat.example"].results;
  assert.equal(state.isError, undefined);
  assert.equal(refused.isError, true);
  assert.deepEqual(clicked.content, [{ type: "text", text: "clicked" }]);
  assert.equal((await readFile(starts, "utf8")).trim().split("\n").length, 1, "one driver for all three jobs");
});

test("a foreground click that waited for the person works once they step away, on the window read before", async t => {
  const { fake, make } = await setup(t);
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "omb-driver-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const driver = path.join(dir, "driver.cjs");
  const starts = path.join(dir, "starts.txt");
  await writeFile(driver, STATEFUL_DRIVER);
  await writeFile(starts, "");
  let idle = 2;
  const sharing = make({ idleSeconds: () => idle, cuaConnection: async () => ({ mcpCommand: process.execPath, mcpArgs: [driver], mcpEnv: { STARTS: starts } }) });
  t.after(() => sharing.close());
  const boat = fake.seen["https://boat.example"];
  const window = { pid: 501, window_id: 77 };
  const click = { action: "computer_call", tool_name: "click", arguments: { ...window, x: 10, y: 10, delivery_mode: "foreground" } };
  boat.jobs.push({ action: "computer_call", tool_name: "get_window_state", arguments: window }, click);
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  await until(() => boat.results.length === 2, "the read and the waiting click");
  assert.match(boat.results[1].content[0].text, /The person is using this computer right now/);
  idle = 120;
  boat.jobs.push(click);
  await until(() => boat.results.length === 3, "the click again");
  assert.deepEqual(boat.results[2].content, [{ type: "text", text: "clicked" }]);
  assert.equal((await readFile(starts, "utf8")).trim().split("\n").length, 1, "the driver that read the window is the one that clicked");
});

test("a job its server ended stops at once, even when its step never returns, and the next job gets the screen", async t => {
  const { fake, make } = await setup(t);
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "omb-driver-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const driver = path.join(dir, "driver.cjs");
  // The very first call this computer ever gets hangs (a helper that never answers); every later one answers.
  await writeFile(driver, `
const fs = require("node:fs");
const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") return send(m.id, { serverInfo: { name: "cua-driver", version: "0.45.4" } });
  if (m.method !== "tools/call") return;
  if (!fs.existsSync(process.env.HUNG)) { fs.writeFileSync(process.env.HUNG, "1"); return; }
  send(m.id, { content: [{ type: "text", text: "ok" }] });
});`);
  const hung = path.join(dir, "hung");
  const hostControl = async () => ({ renew: async () => {}, release: async () => {} });
  // Starting computer control can hang too (a helper waiting on a macOS prompt): the first start never returns.
  let starts = 0;
  const cuaConnection = () => (++starts === 1 ? new Promise(() => {}) : Promise.resolve({ mcpCommand: process.execPath, mcpArgs: [driver], mcpEnv: { HUNG: hung } }));
  await writeFile(hung, "1");
  const sharing = make({ hostControl, cuaConnection });
  t.after(() => sharing.close());
  const boat = fake.seen["https://boat.example"];
  const call = { action: "computer_call", tool_name: "get_desktop_state", arguments: {} };
  boat.jobs.push(call);
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  await until(() => boat.polls > 0 && boat.results.length === 0, "the job taken");
  await delay(100);
  boat.endJobs = true;
  await until(() => boat.results.length === 1, "the ended job answered");
  assert.match(boat.results[0].content[0].text, /request ended|stopped/i);
  boat.endJobs = false;
  boat.jobs.push(call);
  await until(() => boat.results.length === 2, "the next job");
  assert.deepEqual(boat.results[1].content, [{ type: "text", text: "ok" }]);
});

test("a bot's browser calls go to the person's Chrome here, per server and bot, without taking the screen", async t => {
  const { fake, make } = await setup(t);
  const calls = [];
  let screenTaken = 0;
  const lentBrowser = {
    call: async (key, method, params) => { calls.push({ key, method, params }); return method === "tools/list" ? { tools: [{ name: "agent_browser_open", inputSchema: {} }] } : { content: [{ type: "text", text: "opened" }] }; },
    check: async () => ({ ok: true }),
  };
  const sharing = make({ lentBrowser, hostControl: async () => { screenTaken++; return { renew: async () => {}, release: async () => {} }; } });
  t.after(() => sharing.close());
  const boat = fake.seen["https://boat.example"];
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  await until(() => boat.connects.length === 1, "connected");
  assert.equal(boat.connects[0].chrome, undefined, "Chrome isn't offered before the person turns it on");
  sharing.setChrome(true);
  await until(() => boat.connects.at(-1)?.chrome === true, "registered again with Chrome");
  boat.jobs.push(
    { action: "browser_tools", browser_session: "bot-1" },
    { action: "browser_call", tool_name: "agent_browser_open", arguments: { url: "https://www.linkedin.com/" }, browser_session: "bot-1" },
  );
  await until(() => boat.results.length === 2, "both answered");
  assert.deepEqual(boat.results[0], { tools: [{ name: "agent_browser_open", inputSchema: {} }] });
  assert.deepEqual(boat.results[1].content, [{ type: "text", text: "opened" }]);
  const target = sharing.summary().targets[0].id;
  assert.deepEqual(calls.map(call => [call.key, call.method]), [[`${target.slice(0, 8)}-bot-1`, "tools/list"], [`${target.slice(0, 8)}-bot-1`, "tools/call"]]);
  assert.deepEqual(calls[1].params, { name: "agent_browser_open", arguments: { url: "https://www.linkedin.com/" } });
  assert.equal(screenTaken, 0);
});

test("a browser call with Chrome off says how to turn it on, and an upload or another tool is refused before it runs", async t => {
  const { fake, make } = await setup(t);
  const calls = [];
  const sharing = make({ lentBrowser: { call: async (...args) => { calls.push(args); return {}; }, check: async () => ({ ok: true }) } });
  t.after(() => sharing.close());
  const boat = fake.seen["https://boat.example"];
  boat.jobs.push(
    { action: "browser_call", tool_name: "agent_browser_open", arguments: {} },
    { action: "browser_call", tool_name: "agent_browser_upload", arguments: {} },
    { action: "browser_call", tool_name: "click", arguments: {} },
  );
  await sharing.addTarget({ origin: "https://boat.example", code: CODE }, { serverName: "Boat" });
  await until(() => boat.results.length === 3, "three answers");
  assert.match(boat.results[0].content[0].text, /Use my Chrome without the mouse/);
  assert.match(boat.results[1].content[0].text, /Invalid computer request/);
  assert.match(boat.results[2].content[0].text, /Invalid computer request/);
  assert.equal(calls.length, 0);
});
