import assert from "node:assert/strict";
import { test } from "node:test";
import { chromeSetupCommand, createLentBrowser } from "./lent-browser.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("a call goes to this computer's own server with the desktop's headers, and its result comes back", async () => {
  const seen = [];
  const browser = createLentBrowser({
    url: () => "http://127.0.0.1:8799/api/desktop/lent-browser", headers: () => ({ "x-owner": "1" }),
    fetch: async (url, init) => { seen.push({ url, init }); return json({ result: { content: [{ type: "text", text: "ok" }] } }); },
  });
  assert.deepEqual(await browser.call("k1", "tools/call", { name: "agent_browser_open", arguments: { url: "https://example.com" } }), { content: [{ type: "text", text: "ok" }] });
  assert.equal(seen[0].url, "http://127.0.0.1:8799/api/desktop/lent-browser");
  assert.equal(seen[0].init.headers["x-owner"], "1");
  assert.deepEqual(JSON.parse(seen[0].init.body), { key: "k1", method: "tools/call", params: { name: "agent_browser_open", arguments: { url: "https://example.com" } } });
});

test("the check reads one address, and says why when Chrome doesn't answer", async () => {
  const ok = createLentBrowser({ url: () => "http://x", fetch: async () => json({ result: { content: [{ type: "text", text: "https://a" }] } }) });
  assert.deepEqual(await ok.check(), { ok: true });
  const off = createLentBrowser({ url: () => "http://x", fetch: async () => json({ result: { isError: true, content: [{ type: "text", text: "No Chrome with remote debugging" }] } }) });
  assert.deepEqual(await off.check(), { ok: false, error: "No Chrome with remote debugging" });
  const down = createLentBrowser({ url: () => "http://x", fetch: async () => json({ error: "Local desktop only" }, 403) });
  assert.deepEqual(await down.check(), { ok: false, error: "Local desktop only" });
});

test("chrome://inspect opens in Chrome itself on each platform", () => {
  assert.deepEqual(chromeSetupCommand("darwin"), { command: "open", args: ["-a", "Google Chrome", "chrome://inspect/#remote-debugging"] });
  assert.equal(chromeSetupCommand("win32").args.at(-1), "chrome://inspect/#remote-debugging");
});
