// The X card in the real Apps pop-up, against a fake-engine server and a loopback stand-in for treg: no real treg key,
// account or call.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launchVerificationServer, type VerificationServer } from "./control-omb.ts";
import { fixtureApi, mountPreview, type MountedPreview } from "./testing/preview-fixture.ts";

const OWN_KEY = "treg_verify_fixture_key";

async function serveStub(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    req.resume();
    const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (req.headers["x-treg-token"] === OWN_KEY && req.url === "/auth/me") return send(200, { org_id: "org-verify" });
    if (req.headers["x-treg-token"] === OWN_KEY && req.url === "/orgs/org-verify/balance?limit=1") return send(200, { balance_micro: 4_250_000 });
    send(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no stub port");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

const stub = await serveStub();
const output = process.env.OMB_UI_EVIDENCE_DIR || "/tmp/omb-x-connector-evidence";
mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.OMB_VERIFY_BROWSER_CHROME || undefined });
const opened: Array<{ fixture: VerificationServer; ui: MountedPreview }> = [];

async function open() {
  const fixture = await launchVerificationServer({ ...process.env, OMB_TREG_URL: stub.url });
  const ui = await mountPreview(fixture, {
    entry: "/scripts/testing/whop-preview.tsx", route: "/__x.html", title: "Isolated X card",
    extraRoutes: [
      { path: "/api/connectors/catalog", handler: (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ configured: true, mode: "self-hosted", source: "curated",
          cards: [["gmail", "Gmail", "gmail.com"], ["slack", "Slack", "slack.com"], ["twitter", "X (Twitter)", "x.com"]].map(([slug, label, domain]) => ({ slug, label, blurb: "Connect your account", logo: null, domain })) }));
      } },
      { path: /^\/api\/connectors(?:\/connected)?$/, handler: (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ services: {} }));
      } },
    ],
  });
  opened.push({ fixture, ui });
  const pairing = await fixtureApi(fixture.info.url)("POST", "/api/auth/pairing", { scopes: ["admin", "client"] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await page.goto(ui.previewUrl);
  assert.equal(await page.evaluate(async (code: string) => (await fetch("/api/auth/pair", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, cookie: true, label: "X card fixture" }) })).status, pairing.code), 200);
  await page.reload();
  const card = page.locator('[data-app-tile="x"]');
  await card.waitFor();
  return { page, card, errors };
}

const shot = async (page: any, card: any, name: string) => {
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, `${name}.png`) });
  await card.screenshot({ path: join(output, `${name}-card.png`) });
};
const state = (card: any, value: string) => card.locator(`xpath=self::*[@data-x-state="${value}"]`).waitFor();

try {
  // No key: add a treg key.
  const own = await open();
  await state(own.card, "none");
  await own.card.getByText("Add your treg key", { exact: true }).waitFor();
  assert.equal(await own.card.locator('a[href="https://treg.to"]').count(), 1);
  await shot(own.page, own.card, "1-no-key");
  await own.card.getByRole("textbox", { name: "treg key" }).fill(OWN_KEY);
  await own.card.getByRole("button", { name: "Save", exact: true }).click();
  await own.card.getByText("treg is working ✓ Balance: $4.25.", { exact: true }).waitFor();
  await state(own.card, "own");
  await own.card.getByText("Using your treg key", { exact: true }).waitFor();
  await shot(own.page, own.card, "2-own-key");
  await own.card.getByRole("button", { name: "Remove key", exact: true }).click();
  await state(own.card, "none");
  await own.page.setViewportSize({ width: 390, height: 844 });
  await own.card.scrollIntoViewIfNeeded();
  await own.page.screenshot({ path: join(output, "3-narrow.png") });
  assert.equal(await own.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(own.errors, []);
  console.log(JSON.stringify({ passed: true, evidence: output, liveTregTested: false }));
} finally {
  await browser.close();
  for (const { ui, fixture } of opened) { await ui.close(); await fixture.close(); }
  stub.server.close();
}
