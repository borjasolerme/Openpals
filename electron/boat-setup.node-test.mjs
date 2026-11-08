import assert from "node:assert/strict";
import test from "node:test";
import { setupOnBoat } from "./boat-setup.mjs";

const KEY = "test-boat-key";
const ORIGIN = "https://box-1-8799.on.boat.dev";
const LINK = `${ORIGIN}/pair#code=ABCD-EFGH-JKLM`;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake boat.dev: `routes` answers "METHOD /path" (without the query); every call is recorded. */
function boat(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const route = `${init.method} ${pathname.replace("/api/v1", "")}`;
    calls.push({ route, query: Object.fromEntries(searchParams), body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.authorization });
    const answer = routes[route];
    if (!answer) return json(404, { code: "not_found", message: `no route ${route}` });
    return typeof answer === "function" ? answer(calls.at(-1)) : json(200, answer);
  };
  return { fetch, calls };
}

let clock = 0;
const run = (fetch, extra = {}) => {
  const progress = [];
  clock = 0;
  return setupOnBoat({ key: KEY, fetch, sleep: async (ms) => { clock += ms; }, now: () => clock, onProgress: (step) => progress.push(step), ...extra })
    .then((result) => ({ result, progress }));
};

const installerDone = (stdout) => ({ running: false, status: "exited", exitCode: 0, stdout, stderr: "", stdoutNextOffset: stdout.length, stderrNextOffset: 0 });
const happy = (overrides = {}) => ({
  "GET /sandboxes": { sandboxes: [] },
  "POST /sandboxes": { sandbox: { id: "bx_new", state: "provisioning" } },
  "GET /sandboxes/bx_new": { sandbox: { id: "bx_new", state: "ready" } },
  "POST /sandboxes/bx_new/host": { url: `${ORIGIN}/` },
  "GET /sandboxes/bx_new/command-history": { commands: [] },
  "POST /sandboxes/bx_new/commands": { processId: 41 },
  "GET /sandboxes/bx_new/commands/41": installerDone(`==> Installing Node 24\n==> Building the web app\npairing code:  ABCD-EFGH-JKLM\nOPENPALS_PAIRING_LINK=${LINK}\n`),
  ...overrides,
});

test("creates a small, always-on, secret-free machine, hosts its port, installs and returns the pairing link", async () => {
  const { fetch, calls } = boat(happy());
  const { result, progress } = await run(fetch);
  assert.deepEqual(result, { ok: true, link: LINK });
  assert.ok(calls.every((call) => call.auth === `Bearer ${KEY}`));
  assert.deepEqual(calls.find((call) => call.route === "POST /sandboxes").body,
    { name: "openpals", type: "small", ttlSeconds: null, labels: { app: "openpals" }, noEnv: true });
  assert.deepEqual(calls.find((call) => call.route.endsWith("/host")).body, { port: 8799, public: true, localhost: true });
  const command = calls.find((call) => call.route.endsWith("/commands")).body;
  assert.equal(command.detached, true);
  assert.match(command.command, /^curl -fsSL https:\/\/raw\.githubusercontent\.com\/borjasolerme\/Openpals\/main\/scripts\/install-server\.sh \| bash -s -- --public-url https:\/\/box-1-8799\.on\.boat\.dev --label Boat$/);
  assert.deepEqual(progress, [
    { step: "creating" }, { step: "installing" },
    { step: "installing", detail: "Installing Node 24" }, { step: "installing", detail: "Building the web app" },
  ]);
  assert.ok(!JSON.stringify(progress).includes("ABCD"), "no pairing code reaches the page");
});

test("a wrong key says so, and nothing else is tried", async () => {
  for (const [status, body] of [[401, { code: "unauthorized", message: "Unauthorized" }], [403, { error: { code: "forbidden", message: "Forbidden" } }]]) {
    const { fetch, calls } = boat({ "GET /sandboxes": () => json(status, body) });
    const { result } = await run(fetch);
    assert.deepEqual(result, { ok: false, error: { code: "boat-key" } });
    assert.equal(calls.length, 1);
  }
  assert.deepEqual((await run(boat({}).fetch, { key: "  " })).result, { ok: false, error: { code: "boat-key" } });
});

test("a plan or limit refusal shows Boat's own message", async () => {
  const { fetch } = boat(happy({ "POST /sandboxes": () => json(429, { code: "limit_reached", message: "You have reached your plan's sandbox limit." }) }));
  assert.deepEqual((await run(fetch)).result, { ok: false, error: { code: "boat-refused", message: "You have reached your plan's sandbox limit." } });
  const plan = boat(happy({ "POST /sandboxes": () => json(402, { error: { code: "payment_required", message: "Add a payment method." } }) }));
  assert.deepEqual((await run(plan.fetch)).result, { ok: false, error: { code: "boat-refused", message: "Add a payment method." } });
});

test("no connection to boat.dev is a network error", async () => {
  const { result } = await run(async () => { throw new TypeError("fetch failed"); });
  assert.deepEqual(result, { ok: false, error: { code: "network" } });
});

test("a retry resumes the machine an earlier attempt made, and follows its installer still running", async () => {
  let polls = 0;
  const { fetch, calls } = boat(happy({
    "GET /sandboxes": { sandboxes: [{ id: "bx_old", state: "idle" }] },
    "POST /sandboxes/bx_old/host": { url: ORIGIN },
    "GET /sandboxes/bx_old/command-history": { commands: [{ status: "running", processId: 7 }] },
    "GET /sandboxes/bx_old/commands/7": () => (++polls < 3
      ? json(200, { running: true, status: "running", stdout: "==> Building the web app\n", stderr: "", stdoutNextOffset: 25 * polls, stderrNextOffset: 0 })
      : json(200, installerDone(`OPENPALS_PAIRING_LINK=${LINK}\n`))),
  }));
  const { result } = await run(fetch);
  assert.deepEqual(result, { ok: true, link: LINK });
  assert.deepEqual(calls[0].query, { label: "app=openpals", state: "init,provisioning,provisioned,cloning,ready,idle,running" });
  assert.ok(!calls.some((call) => call.route === "POST /sandboxes"), "no second machine");
  assert.ok(!calls.some((call) => call.route.endsWith("/commands")), "no second installer");
  assert.deepEqual(calls.filter((call) => call.route.endsWith("/commands/7")).map((call) => call.query.stdoutOffset), ["0", "25", "50"]);
});

test("a machine that never gets ready, or an installer that never ends, times out", async () => {
  const stuck = boat(happy({ "GET /sandboxes/bx_new": { sandbox: { id: "bx_new", state: "provisioning" } } }));
  assert.deepEqual((await run(stuck.fetch)).result, { ok: false, error: { code: "timeout" } });
  const endless = boat(happy({ "GET /sandboxes/bx_new/commands/41": { running: true, status: "running", stdout: "", stderr: "" } }));
  assert.deepEqual((await run(endless.fetch)).result, { ok: false, error: { code: "timeout" } });
});

test("a failed machine stops with Boat's reason", async () => {
  const { fetch } = boat(happy({ "GET /sandboxes/bx_new": { sandbox: { id: "bx_new", state: "cancelled", error: "No machine was available." } } }));
  assert.deepEqual((await run(fetch)).result, { ok: false, error: { code: "boat-refused", message: "No machine was available." } });
});

test("a failed installer shows its last lines without any pairing code", async () => {
  const stdout = `==> Building the web app\nhttps://x/pair#code=SECRET-CODE\nError: the build ran out of memory\n`;
  const { fetch } = boat(happy({ "GET /sandboxes/bx_new/commands/41": { ...installerDone(stdout), exitCode: 1 } }));
  const { result } = await run(fetch);
  assert.equal(result.error.code, "install-failed");
  assert.match(result.error.output, /ran out of memory/);
  assert.ok(!result.error.output.includes("SECRET"));
});
