import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const env = require("./environments.cjs");

test("origins are bare http(s) origins, nothing else", () => {
  assert.equal(env.normalizeOrigin("https://mini.tail1234.ts.net/pair#code=x"), "https://mini.tail1234.ts.net");
  assert.equal(env.normalizeOrigin("http://192.168.1.20:8799"), "http://192.168.1.20:8799");
  assert.equal(env.normalizeOrigin("HTTPS://Mini.Example:443/"), "https://mini.example");
  for (const bad of ["ftp://x", "mini.example", "https://user:pw@host", "", 42, null]) assert.equal(env.normalizeOrigin(bad), null, String(bad));
});

test("a pairing link keeps its code in the hash; a code anywhere else is refused", () => {
  assert.deepEqual(env.parsePairingLink("https://mini.example/pair#code=ABCD-EFGH-JKLM"), {
    origin: "https://mini.example",
    code: "ABCD-EFGH-JKLM",
    url: "https://mini.example/pair#code=ABCD-EFGH-JKLM",
  });
  assert.deepEqual(env.parsePairingLink("  https://mini.example  "), { origin: "https://mini.example", code: null, url: "https://mini.example" });
  assert.equal(env.parsePairingLink("https://mini.example/?code=ABCD"), null);
  assert.equal(env.parsePairingLink("not a link"), null);
});

test("self-hosted pairing supports custom HTTPS and Cloudflare names without Tailscale", () => {
  for (const origin of ["https://bots.example.com", "https://example.trycloudflare.com", "https://bots.example.net"]) {
    const link = `${origin}/pair#code=ABCD-EFGH-JKLM`;
    assert.deepEqual(env.parsePairingLink(link), {
      origin, code: "ABCD-EFGH-JKLM", url: link,
    });
    const saved = env.withServer(env.LOCAL_PLACE, { origin: link });
    assert.equal(env.activeServer(saved).origin, origin);
    assert.ok(!env.serializePlace(saved).includes("ABCD"), "pairing codes must not enter the saved server");
  }
});

const PLACES = [
  { id: "folder", kind: "local", name: "Work", dataDir: "/Users/me/.openmausbot-work" },
  { id: "vps", kind: "remote", name: "  My   VPS ", origin: "https://vps.example/", microphone: true },
  { id: "mini", name: "Mac mini", origin: "https://mini.example" },
];

test("a version 2 list with a server on screen becomes that server", () => {
  assert.deepEqual(env.parsePlace({ version: 2, environments: PLACES, activeId: "vps" }), {
    server: { origin: "https://vps.example", name: "My VPS", microphone: true }, active: "server",
  });
  assert.deepEqual(env.parsePlace(JSON.stringify({ environments: PLACES, activeId: "mini" })), {
    server: { origin: "https://mini.example", name: "Mac mini" }, active: "server",
  }, "a version 1 entry has no kind and is a server");
});

test("a version 2 list with a data folder of this computer on screen becomes this computer", () => {
  assert.deepEqual(env.parsePlace({ version: 2, environments: PLACES, activeId: "folder" }), env.LOCAL_PLACE);
});

test("every place that was not on screen is dropped, servers included", () => {
  assert.deepEqual(env.parsePlace({ version: 2, environments: PLACES, activeId: "local", localColor: "teal" }), env.LOCAL_PLACE);
  const kept = env.parsePlace({ version: 2, environments: PLACES, activeId: "mini" });
  assert.ok(!env.serializePlace(kept).includes("vps.example"));
  assert.ok(!env.serializePlace(kept).includes("openmausbot-work"));
});

test("anything unreadable is this computer", () => {
  for (const raw of ["{not json", "null", "[]", 42, { version: 4, server: { origin: "https://vps.example" }, active: "server" },
    { version: 2, environments: "nope", activeId: "vps" }, { version: 2, environments: PLACES, activeId: "ghost" },
    { version: 2, environments: [{ id: "x", kind: "cloud", origin: "https://x.example" }], activeId: "x" },
    { version: 2, environments: [{ id: "x", origin: "ftp://x.example" }], activeId: "x" },
    { version: 3, server: { origin: "javascript:alert(1)" }, active: "server" }, { version: 3, server: null, active: "server" }]) {
    assert.deepEqual(env.parsePlace(raw), env.LOCAL_PLACE, JSON.stringify(raw));
  }
});

test("version 3 round-trips, and a server that is not on screen is not kept", () => {
  const server = env.withMicrophone(env.withServer(env.LOCAL_PLACE, { origin: "https://vps.example/pair#code=ABCD-EFGH-JKLM", name: "VPS" }));
  const written = env.serializePlace(server);
  assert.deepEqual(JSON.parse(written), { version: 3, server: { origin: "https://vps.example", name: "VPS", microphone: true }, active: "server" });
  assert.deepEqual(env.parsePlace(written), server);
  assert.deepEqual(JSON.parse(env.serializePlace(env.LOCAL_PLACE)), { version: 3, server: null, active: "local" });
  assert.deepEqual(env.parsePlace(env.serializePlace(env.LOCAL_PLACE)), env.LOCAL_PLACE);
  assert.deepEqual(env.parsePlace({ version: 3, server: { origin: "https://vps.example", name: "VPS" }, active: "local" }), env.LOCAL_PLACE);
});

test("connecting names the server by its host until it has a name, and the same server keeps its microphone answer", () => {
  let state = env.withServer(env.LOCAL_PLACE, { origin: "https://mini.example/pair#code=X" });
  assert.deepEqual(state, { server: { origin: "https://mini.example", name: "mini.example" }, active: "server" });
  assert.equal(env.withServer(state, { origin: "nonsense" }), state);
  state = env.withMicrophone(state);
  assert.equal(env.withServer(state, { origin: "https://mini.example" }).server.microphone, true);
  assert.equal(env.withServer(state, { origin: "https://other.example" }).server.microphone, undefined);
  assert.equal(env.withMicrophone(env.LOCAL_PLACE), env.LOCAL_PLACE);
  assert.deepEqual([...env.guardedOrigins(state, "http://127.0.0.1:8799")], ["http://127.0.0.1:8799", "https://mini.example"]);
  assert.deepEqual([...env.guardedOrigins(env.LOCAL_PLACE, "http://127.0.0.1:8799")], ["http://127.0.0.1:8799"]);
});

test("pages learn where the bots live: this computer, or the server's address and name", () => {
  assert.deepEqual(env.placeView(env.LOCAL_PLACE), { kind: "local" });
  assert.deepEqual(env.placeView(env.withServer(env.LOCAL_PLACE, { origin: "https://acme.example", name: "Acme" })),
    { kind: "server", url: "https://acme.example", label: "Acme" });
});

test("hosted workspace input accepts addresses and keeps valid codes only in the fragment", () => {
  for (const address of ["bots.company.com", " https://bots.company.com/ ", "https://bots.company.com:8443"]) {
    const parsed = env.parseHostedWorkspaceLink(address);
    assert.ok(parsed);
    assert.equal(parsed.code, null);
    assert.equal(parsed.url, parsed.origin);
  }
  const parsed = env.parseHostedWorkspaceLink("https://bots.company.com/pair#code=ABCD%2DEFGH%2DJKLM");
  assert.equal(parsed.code, "ABCD-EFGH-JKLM");
  assert.ok(parsed.url.includes("#code="));
  assert.ok(!parsed.origin.includes("ABCD"));
  assert.ok(env.parseHostedWorkspaceLink("http://127.0.0.1:19999"));
  for (const bad of ["", null, "ABCD-EFGH-JKLM", "https:example.com", "http://cloud.example.com", "https://a.example/other", "https://a.example/?code=SECRET", "https://a.example/pair#code=%", "https://a.example/pair#code=", "https://a.example/pair#code=%20", "https://user:password@a.example", "https://a.example\\@b.example", "javascript:alert(1)"]) {
    assert.equal(env.parseHostedWorkspaceLink(bad), null, String(bad));
  }
  assert.equal(env.parsePairingLink("https://a.example/pair#code=%"), null);
});

const ACME = env.withServer(env.LOCAL_PLACE, { origin: "https://acme.example", name: "Acme" });

test("only the main window's main frame on the place on screen counts as the window's page", () => {
  const local = "http://127.0.0.1:18799";
  const contents = { mainFrame: { url: "https://acme.example/" } };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(env.workspaceSenderAllowed(event, contents, ACME, local), true);
  assert.equal(env.workspaceSenderAllowed({ ...event, sender: {} }, contents, ACME, local), false);
  assert.equal(env.workspaceSenderAllowed({ ...event, senderFrame: { url: "https://acme.example/frame" } }, contents, ACME, local), false);
  contents.mainFrame.url = "https://untrusted.example";
  assert.equal(env.workspaceSenderAllowed(event, contents, ACME, local), false);
  contents.mainFrame.url = local;
  assert.equal(env.workspaceSenderAllowed(event, contents, ACME, local), false);
  assert.equal(env.workspaceSenderAllowed(event, contents, env.LOCAL_PLACE, local), true);
});

test("renderer links and redirects cannot move the window onto this computer's page or another server", () => {
  const local = "http://127.0.0.1:18799";
  assert.equal(env.workspaceNavigationAllowed("https://acme.example/pair#code=ABCD-EFGH-JKLM", ACME, local), true);
  for (const url of [local, "https://other.example", "https://unknown.example", "javascript:void(0)"]) {
    assert.equal(env.workspaceNavigationAllowed(url, ACME, local), false);
  }
  assert.equal(env.workspaceNavigationAllowed(`${local}/settings`, env.LOCAL_PLACE, local), true);
  assert.equal(env.workspaceNavigationAllowed("https://acme.example", env.LOCAL_PLACE, local), false);
});

test("the window's title names the server it shows, whatever the page says", () => {
  assert.equal(env.workspaceWindowTitle(ACME), "Openpals — Hosted: Acme (acme.example)");
  assert.equal(env.workspaceWindowTitle(env.LOCAL_PLACE), "Openpals");
});

test("environments.json: a missing or old file reads as its one place, and a write replaces it whole as version 3", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const { createPlaceFile } = await import("./environments-file.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omb-place-file-"));
  try {
    const file = path.join(dir, "environments.json");
    const store = createPlaceFile({ file: () => file, fs, path });
    assert.deepEqual(store.read(), env.LOCAL_PLACE, "no file yet");
    fs.writeFileSync(file, JSON.stringify({ version: 2, environments: PLACES, activeId: "vps" }));
    const migrated = store.read();
    assert.equal(env.activeServer(migrated).origin, "https://vps.example");
    store.write(migrated);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { version: 3, server: { origin: "https://vps.example", name: "My VPS", microphone: true }, active: "server" });
    assert.deepEqual(fs.readdirSync(dir), ["environments.json"], "no temporary file is left behind");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
