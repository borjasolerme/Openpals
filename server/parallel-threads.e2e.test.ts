// Three threads of one bot, each with a turn held open by a gate only the test releases.
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CONTROL_BUSY } from "./control-client.ts";
import { BROWSER_HANDED_OVER, browserBusyText } from "./host/browser-seats.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
type Role = "desktop";

class Fixture {
  home = mkdtempSync(join(tmpdir(), "omb-parallel-"));
  dataDir = join(this.home, ".openmausbot");
  gates = join(this.home, "gates");
  base = "";
  log = "";
  token = "";
  secret = randomBytes(32).toString("base64url");
  child: ChildProcess | null = null;
  chat: Server | null = null;
  chatInFlight: { thread: string; release: () => void }[] = [];
  extraEnv: Record<string, string> = {};
  readonly role: Role;
  constructor(role: Role) {
    this.role = role;
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(this.gates, { recursive: true });
  }
  headers(extra: Record<string, string> = {}) {
    return {
      origin: this.base,
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }
  async api(method: string, path: string, body?: unknown) {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(body === undefined ? {} : { "content-type": "application/json" }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  }
  async start() {
    const claude = join(this.home, "held-claude.mjs");
    writeFileSync(claude, `#!/usr/bin/env node
import { join } from "node:path";
if (process.argv[2] === "auth") { console.log(JSON.stringify({ loggedIn: true, email: "person@example.test" })); process.exit(0); }
process.env.FAKE_CLAUDE_VERSION = "2.1.284";
if (process.argv[2] !== "--version") {
  process.env.FAKE_CLAUDE_MODE = "slow";
  process.env.FAKE_CLAUDE_SLOW_FINISH_GATE = join(${JSON.stringify(this.gates)}, "release-" + process.pid);
  process.env.FAKE_CLAUDE_DUMP = join(${JSON.stringify(this.gates)}, "claude-" + process.pid + ".json");
}
await import(${JSON.stringify(pathToFileURL(join(SERVER_DIR, "testing", "fake-claude-cli.ts")).href)});
`, { mode: 0o755 });
    const acp = join(this.home, "held-acp.mjs");
    writeFileSync(acp, `#!/usr/bin/env node
process.env.FAKE_ACP_MODE = "echo-gated";
process.env.FAKE_ACP_GATE_FILE = ${JSON.stringify(join(this.gates, "release"))};
process.env.FAKE_ACP_RPC_APPEND_FILE = ${JSON.stringify(join(this.gates, "acp-rpc.jsonl"))};
process.env.FAKE_ACP_MODELS = "fixture-fast";
await import(${JSON.stringify(pathToFileURL(join(SERVER_DIR, "testing", "fake-acp-cli.ts")).href)});
`, { mode: 0o755 });
    this.chat = createServer((req, res) => {
      if (req.method !== "POST") { res.writeHead(404).end("{}"); return; }
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw) as { messages?: { role: string; content: unknown }[]; stream?: boolean };
        const last = JSON.stringify(body.messages?.findLast((m) => m.role === "user")?.content ?? "");
        const entry = { thread: last, release: () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "c", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        } };
        this.chatInFlight.push(entry);
      });
    });
    await new Promise<void>((resolve) => this.chat!.listen(0, "127.0.0.1", resolve));
    const chatUrl = `http://127.0.0.1:${(this.chat.address() as AddressInfo).port}/v1`;
    writeFileSync(join(this.dataDir, "config.json"), JSON.stringify({
      features: { smartSetupChoices: false },
      instances: {
        ...Object.fromEntries(["codex", "cursor", "githubCopilot", "qwen", "hermes", "pi"].map((id) => [id, { driver: "not-a-real-driver" }])),
        claude: { driver: "claudeAgent", displayName: "Claude", config: { cli: claude } },
        heldAcp: { driver: "customAcp", displayName: "Held ACP", config: { cli: acp } },
      },
      openaiCompat: { key: "synthetic-fixture-key", url: chatUrl, model: "fixture-model" },
    }));
    const port = await freePortBlock([0, 1]);
    this.base = `http://127.0.0.1:${port}`;
    const prelude = `data:text/javascript,${encodeURIComponent('const real = globalThis.fetch; globalThis.fetch = async (url, init) => String(url).startsWith("http://127.0.0.1:") ? real(url, init) : new Response("offline fixture", { status: 503 });')}`;
    this.child = spawn(process.execPath, ["--import", prelude, join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { PATH: process.env.PATH, HOME: this.home, USERPROFILE: this.home, OMB_DATA_DIR: this.dataDir, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1), ...this.extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout?.on("data", (chunk) => { this.log += chunk; });
    this.child.stderr?.on("data", (chunk) => { this.log += chunk; });
    await expect.poll(async () => {
      if (this.child!.exitCode !== null) throw new Error(`the server exited:\n${this.log}`);
      return fetch(`${this.base}/api/health`).then((r) => r.ok).catch(() => false);
    }, { timeout: 30_000, interval: 100 }).toBe(true);
  }
  release() {
    writeFileSync(join(this.gates, "release"), "finish");
    for (const held of this.chatInFlight.splice(0)) held.release();
    for (const name of this.claudeDumps()) writeFileSync(join(this.gates, `release-${name.slice("claude-".length, -".json".length)}`), "finish");
  }
  private turnDump(threadId: string) {
    const name = this.claudeDumps().find((file) => basename(this.dump(file).cwd) === threadId);
    if (!name) throw new Error(`no turn is running in ${threadId}`);
    return name;
  }
  /** Finishes only this thread's Claude turn. */
  finish(threadId: string) {
    writeFileSync(join(this.gates, `release-${this.turnDump(threadId).slice("claude-".length, -".json".length)}`), "finish");
  }
  /** The MCP servers this thread's Claude turn was launched with. */
  servers(threadId: string) { return this.dump(this.turnDump(threadId)).mcpConfig.mcpServers; }
  dump(file: string) { return JSON.parse(readFileSync(join(this.gates, file), "utf8")); }
  claudeDumps() {
    return readdirSync(this.gates).filter((name) => {
      if (!name.startsWith("claude-") || !name.endsWith(".json")) return false;
      try { this.dump(name); return true; } catch { return false; }
    });
  }
  async stop() {
    if (this.child && this.child.exitCode === null) { this.child.kill("SIGTERM"); await waitForExit(this.child); }
    await new Promise<void>((resolve) => this.chat ? this.chat.close(() => resolve()) : resolve());
    await removeTempDir(this.home);
  }
  claudeTurnsStarted() { return this.claudeDumps().length; }
  acpPrompts() {
    const file = join(this.gates, "acp-rpc.jsonl");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.method === "session/prompt") : [];
  }
}

const roles: Role[] = ["desktop"];
const CLAUDE = { instanceId: "claude", model: "claude-sonnet-5" };
const engines = [
  { name: "the Claude CLI", selection: CLAUDE, running: (f: Fixture) => f.claudeTurnsStarted() },
  { name: "an ACP agent", selection: { instanceId: "heldAcp", model: "fixture-fast" }, running: (f: Fixture) => f.acpPrompts().length },
  { name: "an OpenAI-compatible model", selection: { instanceId: "openaiCompat", model: "fixture-model" }, running: (f: Fixture) => f.chatInFlight.length },
];

async function botWithThreads(f: Fixture, selection: { instanceId: string; model: string }, count: number, name = "Scout") {
  const created = await f.api("POST", "/api/bots", { name, modelSelection: selection });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const bot = created.body.bot as { id: string; threadId: string };
  const threads = [bot.threadId];
  while (threads.length < count) {
    const made = await f.api("POST", `/api/bots/${bot.id}/tasks`, { title: `Thread ${threads.length + 1}` });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    threads.push(made.body.task.threadId);
  }
  return { botId: bot.id, threads };
}
const botRow = async (f: Fixture, botId: string) => (await f.api("GET", "/api/bots?messages=0")).body.bots.find((row: any) => row.id === botId);
const busyThreads = async (f: Fixture, botId: string) => (await botRow(f, botId)).tasks.filter((task: any) => task.busy).map((task: any) => task.threadId as string);
const send = async (f: Fixture, botId: string, threadId: string, text: string) => {
  const sent = await f.api("POST", `/api/bots/${botId}/messages`, { threadId, text });
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  expect(sent.body.queued, JSON.stringify(sent.body)).toBeUndefined();
};
const rows = async (f: Fixture, threadId: string) => ((await f.api("GET", `/api/threads/${threadId}/messages?limit=30`)).body.messages as any[])
  .map((message) => message.tool?.name).filter((name): name is string => typeof name === "string");
const internal = async (f: Fixture, path: string, token: string, body: unknown) => {
  const response = await fetch(`${f.base}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
};

describe.each(roles)("one bot's threads on a %s server", (role) => {
  let f: Fixture;
  afterEach(async () => { await f?.stop(); });

  it.each(engines)("are all running at once on $name", async ({ selection, running }) => {
    f = new Fixture(role);
    await f.start();
    const { botId, threads } = await botWithThreads(f, selection, 3);
    await Promise.all(threads.map((threadId, i) => send(f, botId, threadId, `Long job ${i}`)));
    await expect.poll(() => running(f), { timeout: 20_000, interval: 50 }).toBe(3);
    expect((await busyThreads(f, botId)).sort()).toEqual([...threads].sort());
    f.release();
    await expect.poll(async () => (await botRow(f, botId)).busy, { timeout: 20_000, interval: 100 }).toBe(false);
  }, 90_000);

  it("still count as busy while one finishes and another runs, so the bot is not idle under the other", async () => {
    f = new Fixture(role);
    await f.start();
    const { botId, threads } = await botWithThreads(f, CLAUDE, 2);
    await send(f, botId, threads[0]!, "Long job 0");
    await send(f, botId, threads[1]!, "Long job 1");
    await expect.poll(() => f.claudeTurnsStarted(), { timeout: 20_000, interval: 50 }).toBe(2);
    f.finish(threads[0]!);
    await expect.poll(() => busyThreads(f, botId), { timeout: 20_000, interval: 100 }).toEqual([threads[1]]);
    expect((await botRow(f, botId)).busy).toBe(true);
    f.release();
    await expect.poll(async () => (await botRow(f, botId)).busy, { timeout: 20_000, interval: 100 }).toBe(false);
  }, 90_000);
});

/** An agent-browser stand-in answering MCP: no Chrome, no page. */
function inertBrowser(dir: string) {
  const browser = join(dir, "agent-browser");
  writeFileSync(browser, [
    "#!/usr/bin/env node",
    'import { createInterface } from "node:readline";',
    'if (process.argv[2] === "mcp") {',
    '  createInterface({ input: process.stdin }).on("line", (line) => {',
    '    const message = JSON.parse(line); if (message.id === undefined) return;',
    '    const result = message.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "inert-browser", version: "1" } }',
    '      : message.method === "tools/list" ? { tools: [{ name: "agent_browser_snapshot", inputSchema: { type: "object" } }] }',
    '      : { content: [{ type: "text", text: "inert browser action" }] };',
    '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");',
    '  });',
    '} else { if (process.argv[2] === "session") console.log(JSON.stringify({ success: true, data: { sessions: [] } })); process.exit(0); }',
  ].join("\n"), { mode: 0o755 });
  return browser;
}
const browse = (f: Fixture, threadId: string) => internal(f, "/api/internal/browser/mcp", f.servers(threadId).browser.env.OMB_MCP_TOKEN_BROWSER, {
  method: "tools/call", params: { name: "agent_browser_snapshot", arguments: {} },
});

// The stand-in is a script with a shebang, which Windows cannot run as a program.
describe.skipIf(process.platform === "win32").each(["desktop"] as const)("two threads wanting one bot's browser on a %s server", (role) => {
  let f: Fixture;
  afterEach(async () => { await f?.stop(); });
  const running = async (env: Record<string, string>) => {
    f = new Fixture(role);
    f.extraEnv = { OMB_AGENT_BROWSER_PATH: inertBrowser(f.home), OMB_COMPUTER_CALL_WAIT_MS: "500", ...env };
    await f.start();
    const { botId, threads } = await botWithThreads(f, CLAUDE, 2);
    await send(f, botId, threads[0]!, "First job");
    await send(f, botId, threads[1]!, "Second job");
    await expect.poll(() => f.claudeTurnsStarted(), { timeout: 20_000, interval: 50 }).toBe(2);
    return { botId, threads };
  };

  it("wait in plain sight while both keep working, and the second gets it when the first finishes", async () => {
    const { botId, threads } = await running({});
    expect((await browse(f, threads[0]!)).body.result.isError).toBeFalsy();
    const waiting = await browse(f, threads[1]!);
    expect(waiting.status, "the second thread's call is answered, not refused").toBe(200);
    expect(waiting.body.result).toEqual({ isError: true, content: [{ type: "text", text: browserBusyText(500) }] });
    expect((await rows(f, threads[1]!)).find((name) => name.startsWith("Waiting for the browser")), "the person sees why").toContain("Scout is using it");
    expect((await busyThreads(f, botId)).sort(), "both threads run at once").toEqual([...threads].sort());
    f.finish(threads[0]!);
    await expect.poll(async () => (await browse(f, threads[1]!)).body.result.isError, { timeout: 20_000, interval: 100 }).toBeFalsy();
    await expect.poll(() => rows(f, threads[1]!), { timeout: 10_000, interval: 50 }).toContain("The browser is free. Continuing.");
    f.release();
    await expect.poll(async () => (await botRow(f, botId)).busy, { timeout: 20_000, interval: 100 }).toBe(false);
  }, 90_000);

  it("hand the browser over once its holder has stopped using it, and the holder does not act on a page it did not open", async () => {
    const { botId, threads } = await running({ OMB_BROWSER_IDLE_HANDOVER_MS: "200", OMB_COMPUTER_CALL_WAIT_MS: "5000" });
    expect((await browse(f, threads[0]!)).body.result.isError).toBeFalsy();
    expect((await browse(f, threads[1]!)).body.result.isError, "taken from a holder that went quiet, with both turns still running").toBeFalsy();
    expect((await busyThreads(f, botId)).sort()).toEqual([...threads].sort());
    expect((await browse(f, threads[0]!)).body.result.content[0].text).toBe(BROWSER_HANDED_OVER);
    expect((await browse(f, threads[0]!)).body.result.isError).toBeFalsy();
    f.release();
    await expect.poll(async () => (await botRow(f, botId)).busy, { timeout: 20_000, interval: 100 }).toBe(false);
  }, 90_000);
});

// One stub plays Boat's public API v1 on the person's own key; a picture stands in for the desktop.
const OWN_KEY = "boat_own_fixture";
const FRAME = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
describe.each(["desktop"] as const)("two threads of a bot on the team's shared computer on a %s server", (role) => {
  let f: Fixture;
  const servers: Server[] = [];
  afterEach(async () => {
    await f?.stop();
    for (const server of servers.splice(0)) { server.closeAllConnections(); server.close(); }
  });

  it("both run from the start, and only the one that reaches for the screen second waits, saying so", async () => {
    const sandboxes: Array<{ id: string; state: string; name?: string }> = [];
    const boat = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://boat.test");
      const path = url.pathname.replace(/^\/boat\/api\/v1/, "");
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const answer = (status: number, payload: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
        if (req.headers.authorization !== `Bearer ${OWN_KEY}` || !url.pathname.startsWith("/boat/api/v1/")) {
          return answer(401, { ok: false, code: "unauthorized", message: "Unauthorized" });
        }
        if (path === "/sandboxes" && req.method === "GET") return answer(200, { ok: true, sandboxes, pageInfo: { nextCursor: null } });
        if (path === "/sandboxes" && req.method === "POST") {
          const sandbox = { id: "bx_23456789", state: "ready" };
          sandboxes.push(sandbox);
          return answer(202, { ok: true, type: "sandbox.created", sandbox });
        }
        const [, id = "", verb = ""] = /^\/sandboxes\/([^/]+)(?:\/(.+))?$/.exec(path) ?? [];
        const sandbox = sandboxes.find((candidate) => candidate.id === id);
        if (!sandbox) return answer(404, { ok: false, code: "not_found", message: "Not found" });
        if (!verb && req.method === "PATCH") { sandbox.name = JSON.parse(raw).name; return answer(200, { ok: true, sandbox }); }
        if (!verb && req.method === "GET") return answer(200, { ok: true, sandbox });
        if (verb === "desktop") return answer(200, { desktopUrl: `https://desktop.invalid/${sandbox.id}` });
        if (verb === "commands") return answer(200, { exitCode: 0, stdout: "captured", stderr: "" });
        if (verb === "artifacts") { res.writeHead(200, { "content-type": "image/jpeg", "content-length": String(FRAME.length) }); return res.end(FRAME); }
        return answer(404, { ok: false, code: "not_found", message: "Not found" });
      });
    });
    servers.push(boat);
    await new Promise<void>((resolve) => boat.listen(0, "127.0.0.1", resolve));
    const boatBase = `http://127.0.0.1:${(boat.address() as AddressInfo).port}`;
    f = new Fixture(role);
    f.extraEnv = { OMB_BOAT_API: `${boatBase}/boat/api/v1`, BOX_TOKEN: OWN_KEY, OMB_COMPUTER_CALL_WAIT_MS: "500" };
    await f.start();
    const requestId = randomUUID();
    const made = await f.api("POST", "/api/team-computers", { requestId, name: "Ops desktop", acknowledgeCost: true });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const { botId, threads } = await botWithThreads(f, CLAUDE, 2);
    expect((await f.api("PATCH", `/api/bots/${botId}`, { section: "Ops" })).status).toBe(200);
    const assigned = await f.api("PATCH", `/api/team-computers/${requestId}`, { section: "Ops", acknowledgeSharedAccess: true });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);

    await send(f, botId, threads[0]!, "First job");
    await send(f, botId, threads[1]!, "Second job");
    await expect.poll(() => f.claudeTurnsStarted(), { timeout: 20_000, interval: 50 }).toBe(2);
    expect((await busyThreads(f, botId)).sort(), "neither has touched the computer, so neither waited for it").toEqual([...threads].sort());
    expect((await rows(f, threads[1]!)).filter((name) => name.startsWith("Waiting for its turn"))).toEqual([]);

    const screenshot = (threadId: string) => {
      const env = f.servers(threadId).computer.env;
      return internal(f, "/api/internal/computer/mcp", env.OMB_MCP_TOKEN_COMPUTER, { method: "tools/call", params: { name: "screenshot", arguments: {} } });
    };
    let first = await screenshot(threads[0]!);
    for (let attempt = 0; attempt < 40 && first.body.result?.isError; attempt++) first = await screenshot(threads[0]!);
    expect(first.body.result.isError, JSON.stringify(first.body)).toBeFalsy();
    const second = await screenshot(threads[1]!);
    expect(second.body.result).toEqual({ isError: true, content: [{ type: "text", text: CONTROL_BUSY }] });
    expect((await rows(f, threads[1]!)).find((name) => name.startsWith("Waiting for its turn on this computer")), "the person sees why").toContain("Scout is running");
    expect((await busyThreads(f, botId)).sort()).toEqual([...threads].sort());

    f.finish(threads[0]!);
    await expect.poll(async () => (await screenshot(threads[1]!)).body.result.isError, { timeout: 30_000, interval: 200 }).toBeFalsy();
    f.release();
    await expect.poll(async () => (await botRow(f, botId)).busy, { timeout: 20_000, interval: 100 }).toBe(false);
  }, 120_000);
});

