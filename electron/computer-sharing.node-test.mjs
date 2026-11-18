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
    if (route.endsWith("/lease")) return json({ active: true });
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
