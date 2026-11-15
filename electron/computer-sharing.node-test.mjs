import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createComputerSharing, parseLendingRecord } from "./computer-sharing.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

/** A paired server that answers lending as the real one does, recording what it was told. */
function fakeServer({ scopes = ["admin", "client"], workComputers = true } = {}) {
  const seen = { connects: [], disconnects: [], polls: 0 };
  const fetchImpl = async (url, init) => {
    const route = new URL(url).pathname;
    seen.origin = init?.headers?.origin;
    seen.secret = init?.headers?.["x-omb-computer-secret"] ?? seen.secret;
    if (route === "/.well-known/openmausbot/environment") return json({ environmentId: "6f1c1f7e-2c55-4a4f-9a51-0c1c7d6f0a11", capabilities: {} });
    if (route === "/api/auth/session") return json({ kind: "session", id: randomUUID(), scopes, ...(workComputers ? { workComputers: true } : {}) });
    const body = init?.body ? JSON.parse(init.body) : {};
    if (route === "/api/shared-computers/connect") { seen.connects.push(body); return json({ ok: true }); }
    if (route.endsWith("/poll")) { seen.polls++; await delay(20, undefined, { signal: init.signal }).catch(() => {}); return json({ job: null }); }
    if (route.endsWith("/disconnect")) { seen.disconnects.push(body); return json({ ok: true }); }
    return json({ error: "not found" }, 404);
  };
  return { seen, fetchImpl };
}

async function until(check, what) {
  for (let i = 0; i < 200; i++) { if (check()) return; await delay(10); }
  assert.fail(`timed out waiting for ${what}`);
}

async function setup(t, options) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "omb-lending-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "computer-sharing.json");
  const paired = { current: { origin: "https://boat.example", name: "Boat server" } };
  const fake = fakeServer(options);
  const summaries = [];
  const make = () => createComputerSharing({ file, fetch: fake.fetchImpl, server: () => paired.current, computerName: () => "Borja's Mac mini", platform: "darwin",
    onChange: summary => summaries.push(summary), retryMs: [5] });
  return { file, paired, fake, summaries, make };
}

test("turning lending on registers this computer by its own name over the paired session, with apps and screen and nothing else", async t => {
  const { fake, make, file } = await setup(t);
  const sharing = make();
  t.after(() => sharing.close());
  const view = sharing.turnOn();
  assert.equal(view.on, true);
  assert.equal(view.name, "Borja's Mac mini");
  await until(() => fake.seen.connects.length === 1 && sharing.summary().state === "online", "registration");
  const [registration] = fake.seen.connects;
  assert.deepEqual({ name: registration.name, platform: registration.platform, computer: registration.computer, terminal: registration.terminal, folders: registration.folders },
    { name: "Borja's Mac mini", platform: "darwin", computer: true, terminal: false, folders: [] });
  assert.equal(fake.seen.origin, "https://boat.example");
  assert.match(fake.seen.secret, /^[a-f0-9]{64}$/);
  const saved = parseLendingRecord(JSON.parse(await readFile(file, "utf8")));
  assert.equal(saved.origin, "https://boat.example");
  assert.equal(registration.id, saved.id);
});

test("pause tells the server it is paused and stops polling; resume and a new name register again; stop says it is no longer lent", async t => {
  const { fake, make } = await setup(t);
  const sharing = make();
  t.after(() => sharing.close());
  sharing.turnOn();
  await until(() => sharing.summary().state === "online", "online");
  assert.equal((await sharing.pause()).paused, true);
  assert.deepEqual(fake.seen.disconnects, [{ paused: true }]);
  const polls = fake.seen.polls;
  await delay(60);
  assert.equal(fake.seen.polls, polls, "nothing is polled while paused");
  sharing.resume();
  sharing.rename("Mac mini");
  await until(() => fake.seen.connects.at(-1)?.name === "Mac mini" && sharing.summary().state === "online", "resumed under the new name");
  assert.equal((await sharing.turnOff()).on, false);
  assert.deepEqual(fake.seen.disconnects.at(-1), {});
  assert.equal(sharing.summary().state, "off");
});

test("lending follows only the server it was turned on for, and comes back by itself after a restart", async t => {
  const { fake, make, paired } = await setup(t);
  const first = make();
  first.turnOn();
  await until(() => first.summary().state === "online", "online");
  first.close();
  paired.current = { origin: "https://someone-else.example", name: "Other" };
  const second = make();
  t.after(() => second.close());
  await until(() => second.summary().problem === "other-server", "other server refused");
  const connects = fake.seen.connects.length;
  paired.current = { origin: "https://boat.example", name: "Boat server" };
  second.serverChanged();
  await until(() => fake.seen.connects.length === connects + 1 && second.summary().state === "online", "back on its own server");
});

test("a chat-only pairing and a server without work computers never register", async t => {
  for (const [options, expected] of [[{ scopes: ["client"] }, "not-admin"], [{ workComputers: false }, "unsupported"]]) {
    const { fake, make } = await setup(t, options);
    const sharing = make();
    sharing.turnOn();
    await until(() => sharing.summary().problem === expected, expected);
    assert.equal(fake.seen.connects.length, 0);
    sharing.close();
  }
});

test("turning on needs a paired server; a record from another version is ignored", async t => {
  const { make, paired } = await setup(t);
  paired.current = null;
  const sharing = make();
  t.after(() => sharing.close());
  assert.throws(() => sharing.turnOn(), /Connect this app to your server first/);
  assert.equal(parseLendingRecord({ version: 1, records: {} }), null);
  assert.equal(parseLendingRecord({ version: 2, id: "not-a-uuid", secret: "a".repeat(64), origin: "https://x" }), null);
});
