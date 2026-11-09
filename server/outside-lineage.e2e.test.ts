// Work that came in from outside stays with that work on a desktop, with the fake engine: the level each turn really got,
// read from what the engine was started with.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const KEY = randomBytes(16).toString("hex");

let child: ChildProcess;
let home = "", base = "", stderr = "", dump = "", release = "";

const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const read = () => { try { return JSON.parse(readFileSync(dump, "utf8")); } catch { return null; } };
const turnWith = async (marker: string) => {
  let turn: any = null;
  await expect.poll(() => (turn = read()) && JSON.stringify(turn.prompt ?? "").includes(marker), { timeout: hostTimeout(30_000) }).toBe(true);
  return turn as { argv: string[] };
};
const atFull = (turn: { argv: string[] }) => turn.argv[turn.argv.indexOf("--permission-mode") + 1] === "bypassPermissions";
const idle = (...ids: string[]) => expect.poll(async () => {
  const bots = (await api("GET", "/api/bots?messages=0")).body.bots as any[];
  return ids.every((id) => !bots.find((bot) => bot.id === id)?.busy);
}, { timeout: hostTimeout(30_000) }).toBe(true);
const handOn = async (from: string, threadId: string, to: string, message: string) => {
  const minted = await api("POST", "/api/testing/internal-capability", { botId: from, threadId, kind: "agents" }, { "x-openmausbot-test-capability": KEY });
  expect(minted.status).toBe(201);
  const sent = await api("POST", `/api/internal/coordinate-bots?fromBotId=${from}`, { fromBotId: from, fromThreadId: threadId, botIds: [to], message, reply: "none" },
    { authorization: `Bearer ${minted.body.token}` });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-outside-lineage-"));
  const data = join(home, ".openmausbot"), staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Outside lineage test</title>");
  dump = join(home, "dump.json");
  release = join(home, "release");
  writeFileSync(join(data, "config.json"), JSON.stringify({ instances: { fake: {
    driver: "claudeAgent", displayName: "Fake", config: { cli: FAKE_CLAUDE },
    environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_RELEASE: release },
  } } }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1), OMB_STATIC_DIR: staticDir,
      OMB_TEST_INTERNAL_CAPABILITY_KEY: KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try { if ((await fetch(`${base}/api/health`)).status === 200) break; } catch { /* not up yet */ }
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(async () => {
  if (release) writeFileSync(release, "");
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

const newBot = async (name: string, settings: Record<string, unknown>) => {
  const bot = (await api("POST", "/api/bots", { name, modelSelection: { instanceId: "fake", model: "claude-sonnet-5" } })).body.bot as { id: string; threadId: string };
  expect((await api("PATCH", `/api/bots/${bot.id}`, { ...settings, applyToAllThreads: true })).status).toBe(200);
  return bot;
};

it("brings no level down from a webhook's Chief, during its run and after it has ended: the teammate keeps its own", async () => {
  const chief = await newBot("Desk chief", { chiefOfStaff: true, approvalMode: "full" });
  const mate = await newBot("Desk mate", { approvalMode: "ask" });

  // A person's own conversation with the Chief hands its Full access down.
  writeFileSync(release, "");
  expect((await api("POST", `/api/bots/${chief.id}/messages`, { text: "Warm up" })).status).toBe(202);
  await idle(chief.id);
  await handOn(chief.id, chief.threadId, mate.id, "brief-person");
  expect(atFull(await turnWith("brief-person"))).toBe(true);
  await idle(chief.id, mate.id);

  // A webhook's run keeps the Chief's own level, but hands none of it on.
  rmSync(release, { force: true });
  const hook = (await api("POST", "/api/webhooks", { name: "Desk hook", prompt: "Handle the event.", botId: chief.id })).body;
  const delivered = await fetch(hook.credential.url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomBytes(6).toString("hex") },
    body: JSON.stringify({ text: "marker-desktop" }) });
  expect(delivered.status).toBe(202);
  expect(atFull(await turnWith("marker-desktop"))).toBe(true);
  const thread = ((await api("GET", "/api/routines")).body.runs as any[]).find((run) => run.webhookId === hook.webhook.id).threadId as string;
  await handOn(chief.id, thread, mate.id, "brief-desktop");
  expect(atFull(await turnWith("brief-desktop"))).toBe(false);

  // Once the run has ended, the conversation's own record still keeps the level where it is.
  writeFileSync(release, "");
  await idle(chief.id, mate.id);
  await handOn(chief.id, thread, mate.id, "brief-after");
  expect(atFull(await turnWith("brief-after"))).toBe(false);
  await idle(chief.id, mate.id);
}, hostTimeout(120_000));
