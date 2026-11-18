// The lending protocol end to end, in one process: this server's routes and registry, the desktop's own lending client
// (electron/computer-sharing.mjs) polling them over HTTP, and a stand-in for cua-driver on the lent computer. A bot turn
// reaches that computer only through the rpc a turn's capability names.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createComputerSharing } from "../electron/computer-sharing.mjs";
import { json, readBody } from "./harness/http.ts";
import { createWorkComputers } from "./host/work-computers.ts";
import { LENT_COMMAND_TOOL } from "./lent-computer-tools.ts";
import { LENT_BROWSER_FALLBACK } from "./lent-screen-guidance.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS } from "./routes/table.ts";
import { TurnResources } from "./turn-resources.ts";

const ENVIRONMENT = "0b6d7c1e-6a43-4d57-8f0e-2a1b9c3d4e5f";
const PNG = Buffer.from("fake screen").toString("base64");
/** Speaks cua-driver's MCP over stdio: three screen tools, and a screenshot. */
const FAKE_DRIVER = `
const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") return send(m.id, { serverInfo: { name: "cua-driver", version: "0.45.4" } });
  if (m.method === "tools/list") return send(m.id, { tools: [
    { name: "get_desktop_state", description: "See the screen", inputSchema: { type: "object", properties: { max_image_dimension: { type: "integer" }, screenshot_out_file: { type: "string" } } } },
    { name: "list_apps", description: "Apps", inputSchema: { type: "object", properties: {} } },
    { name: "write_anywhere", description: "Not lent", inputSchema: { type: "object", properties: {} } },
  ] });
  if (m.method === "tools/call" && m.params.name === "get_desktop_state") return send(m.id, { content: [{ type: "image", mimeType: "image/png", data: "${PNG}" }] });
  if (m.method === "tools/call") return send(m.id, { content: [{ type: "text", text: "apps: Finder" }] });
});`;

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function lendingFixture({ owner = true, terminal = false, lentBrowser = null as Parameters<typeof createComputerSharing>[0]["lentBrowser"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omb-work-computers-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const driver = join(dir, "fake-driver.cjs");
  writeFileSync(driver, FAKE_DRIVER);
  const own = { now: owner };
  const work = createWorkComputers({ dataDir: dir, environmentId: ENVIRONMENT, sessionLive: () => true, ownServer: () => own.now,
    turnResources: new TurnResources(), holderName: () => undefined });
  cleanups.push(() => work.close());
  // The lend-only session the link from "Add a computer" trades its one-time code for.
  const TOKEN = "omb_sess_lend-test";
  const session = { id: "lend-session", scopes: ["lend"], label: "Mac mini" };
  const auth = { kind: "session", session, via: "bearer", scopes: session.scopes } as unknown as RequestAuth;
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/.well-known/openmausbot/environment") return json(res, 200, { environmentId: ENVIRONMENT, label: "Boat server", capabilities: {} });
    if (url.pathname === "/api/auth/pair") {
      const body = await readBody(req) as { code?: string };
      return body?.code === "ABCD-EFGH-JKLM" ? json(res, 200, { token: TOKEN, environment: { label: "Boat server" } }) : json(res, 400, { error: "invalid code" });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { error: "unauthorized" });
    try {
      const out = await work.routes({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (out === PASS) json(res, 404, { error: "no route" });
    } catch (error) {
      json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const desktop = createComputerSharing({
    file: join(dir, "desktop", "computer-sharing.json"), fetch: globalThis.fetch,
    computerName: () => "Mac mini", platform: "darwin", retryMs: [20],
    cuaConnection: async () => ({ mcpCommand: process.execPath, mcpArgs: [driver], mcpEnv: {} }), lentBrowser,
  });
  cleanups.push(() => desktop.close());
  await desktop.addTarget({ origin, code: "ABCD-EFGH-JKLM" }, { serverName: "fallback" });
  if (terminal) desktop.setTerminal(true);
  if (lentBrowser) desktop.setChrome(true);
  const online = async () => {
    for (let i = 0; i < 300; i++) {
      const listed = work.list().find((computer) => computer.online);
      if (listed) return listed;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("the computer never came online");
  };
  const turn = (computerId: string, confirm = async () => {}) => ({
    computerId, gate: async () => ({ held: false }), confirm, assertActive: () => {}, active: () => true,
  });
  return { work, desktop, online, turn, own };
}

describe("a Mac lent to this server, end to end", () => {
  it("trades the link's code for a lend-only session and lends under the server's own name", async () => {
    const { desktop, online } = await lendingFixture();
    await online();
    for (let i = 0; i < 300 && desktop.summary().targets[0]?.state !== "online"; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(desktop.summary().targets).toEqual([expect.objectContaining({ serverName: "Boat server", state: "online", paused: false })]);
  });

  it("comes online under its own name, and a bot's turn sees and uses only its lent screen tools", async () => {
    const { work, online, turn } = await lendingFixture();
    const computer = await online();
    expect(computer).toMatchObject({ name: "Mac mini", platform: "darwin", online: true, paused: false, lent: true });
    const listed = await work.rpc({ method: "tools/list" }, turn(computer.id)) as { tools: Array<{ name: string; inputSchema: { properties: object } }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual(["get_desktop_state", "list_apps"]);
    expect(Object.keys(listed.tools[0]!.inputSchema.properties)).toEqual(["max_image_dimension"]);
    const called = await work.rpc({ method: "tools/call", params: { name: "list_apps", arguments: {} } }, turn(computer.id));
    expect(called).toMatchObject({ content: [{ type: "text", text: "apps: Finder" }] });
    const refused = await work.rpc({ method: "tools/call", params: { name: "write_anywhere", arguments: {} } }, turn(computer.id)) as { isError?: boolean };
    expect(refused.isError).toBe(true);
  });

  it("takes a screenshot through it for Test connection, and renames it for the owner", async () => {
    const { work, online } = await lendingFixture();
    const computer = await online();
    const tested = await testThrough(work, computer.id);
    expect(tested).toEqual({ ok: true, image: { mimeType: "image/png", data: PNG } });
    const renamed = await ownerCall(work, `/api/work-computers/${computer.id}`, "PATCH", { name: "Studio Mac" });
    expect(renamed).toMatchObject({ computer: { id: computer.id, name: "Studio Mac" } });
    expect(await ownerCall(work, "/api/work-computers", "GET")).toMatchObject({ computers: [{ id: computer.id, name: "Studio Mac", online: true }] });
  });

  it("asks the person before a command, and never runs one when the terminal isn't lent", async () => {
    const { work, online, turn } = await lendingFixture();
    const computer = await online();
    const listed = await work.rpc({ method: "tools/list" }, turn(computer.id)) as { tools: Array<{ name: string }> };
    expect(listed.tools.some((tool) => tool.name === LENT_COMMAND_TOOL)).toBe(false);
    const refused = await work.rpc({ method: "tools/call", params: { name: LENT_COMMAND_TOOL, arguments: { command: "echo hi" } } }, turn(computer.id)) as unknown as { isError?: boolean; content: Array<{ text: string }> };
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/does not lend its terminal/);

    const lent = await lendingFixture({ terminal: true });
    const withTerminal = await lent.online();
    for (let i = 0; i < 300 && !lent.work.list().find((one) => one.id === withTerminal.id)?.scopes.terminal; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    let asked = 0;
    const declined = await lent.work.rpc({ method: "tools/call", params: { name: LENT_COMMAND_TOOL, arguments: { command: "echo hi" } } },
      lent.turn(withTerminal.id, async () => { asked++; throw new Error("the person said no"); })) as unknown as { isError?: boolean; content: Array<{ text: string }> };
    expect(asked).toBe(1);
    expect(declined).toMatchObject({ isError: true, content: [{ text: "the person said no" }] });
    const ran = await lent.work.rpc({ method: "tools/call", params: { name: LENT_COMMAND_TOOL, arguments: { command: "echo lent-ok" } } }, lent.turn(withTerminal.id)) as unknown as { content: Array<{ text: string }> };
    expect(JSON.parse(ran.content[0]!.text)).toMatchObject({ exitCode: 0, output: "lent-ok\n" });
  });

  it("keeps the screen tools when the person's Chrome fails a browser call there, and tells the bot to use them", async () => {
    const calls: unknown[][] = [];
    const lentBrowser = {
      call: async (...args: unknown[]) => { calls.push(args); throw new Error("Chrome refused the connection: Allow wasn't clicked"); },
      check: async () => ({ ok: true as const }),
    };
    const { work, online, turn } = await lendingFixture({ lentBrowser });
    const computer = await online();
    for (let i = 0; i < 300 && !work.lendsChrome(computer.id); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(work.lendsChrome(computer.id)).toBe(true);
    const mounted = work.mount(computer.id)!;
    expect(work.prompt(mounted)).toMatch(/agent_browser_\* tools first/);
    expect(work.prompt(mounted)).toMatch(/Your screen tools stay available: .*a browser call fails, do the page with the screen instead/);

    const browserTurn = { computerId: computer.id, botId: "bot-1", assertActive: () => {}, active: () => true };
    const failed = await work.browserRpc({ method: "tools/call", params: { name: "agent_browser_open", arguments: { url: "https://example.com" } } }, browserTurn) as unknown as { isError?: boolean; content: Array<{ text: string }> };
    expect(calls).toHaveLength(1);
    expect(failed.isError).toBe(true);
    expect(failed.content.map((part) => part.text)).toEqual(["Chrome refused the connection: Allow wasn't clicked", LENT_BROWSER_FALLBACK]);
    expect(LENT_BROWSER_FALLBACK).toMatch(/launch_app with urls .* get_window_state .* click/);

    const listed = await work.rpc({ method: "tools/list" }, turn(computer.id)) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual(["get_desktop_state", "list_apps"]);
    expect(await work.rpc({ method: "tools/call", params: { name: "list_apps", arguments: {} } }, turn(computer.id))).toMatchObject({ content: [{ type: "text", text: "apps: Finder" }] });
  });

  it("tells the bot a paused computer is paused, and lists it as paused for the owner", async () => {
    const { work, desktop, online, turn } = await lendingFixture();
    const computer = await online();
    await desktop.pause();
    expect(work.list()).toEqual([expect.objectContaining({ id: computer.id, online: false, paused: true, lent: true })]);
    expect(work.mount(computer.id)).toMatchObject({ online: false });
    const answer = await work.rpc({ method: "tools/call", params: { name: "list_apps", arguments: {} } }, turn(computer.id)) as unknown as { isError?: boolean; content: Array<{ text: string }> };
    expect(answer.isError).toBe(true);
    expect(answer.content[0]!.text).toMatch(/Mac mini is paused/);
    expect(await work.rpc({ method: "tools/list" }, turn(computer.id))).toEqual({ tools: [] });
  });

  it("refuses lending once someone else can sign in here, and a desktop sees it can't lend", async () => {
    const { work, desktop, own } = await lendingFixture({ owner: false });
    const problem = () => desktop.summary().targets[0]?.problem;
    for (let i = 0; i < 300 && problem() !== "unsupported"; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(problem()).toBe("unsupported");
    expect(work.list()).toEqual([]);
    expect(own.now).toBe(false);
  });
});

/** The owner's own page asking, as the desktop that runs this server does (loopback). */
async function ownerCall(work: ReturnType<typeof createWorkComputers>, path: string, method: string, body: unknown = {}) {
  let answer: unknown;
  await work.routes({
    req: {} as never, res: {} as never, url: new URL(`http://x${path}`), path, method,
    auth: { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth,
    json: ((_res: unknown, _status: number, value: unknown) => { answer = value; }) as never,
    readBody: (async () => body) as never,
  });
  return answer;
}

const testThrough = (work: ReturnType<typeof createWorkComputers>, id: string) => ownerCall(work, `/api/work-computers/${id}/test`, "POST");
