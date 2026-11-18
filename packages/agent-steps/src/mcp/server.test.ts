import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../cli.ts";
import { FileStore } from "../store.ts";
import { agentBrowserDriver } from "../web/driver.ts";
import { StdioMcpClient } from "./client.ts";
import { createStepsServer, STEPS_TOOLS } from "./server.ts";

const FAKE = fileURLToPath(new URL("../testing/fake-browser-mcp.mjs", import.meta.url));
const BIN = fileURLToPath(new URL("../bin.ts", import.meta.url));

let dir: string;
let log: string;
const clients: StdioMcpClient[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-steps-mcp-"));
  log = join(dir, "actions.log");
});
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  rmSync(dir, { recursive: true, force: true });
});

async function server(links = "Billing,Help") {
  const client = new StdioMcpClient(process.execPath, [FAKE], { ...process.env, FAKE_LINKS: links, FAKE_LOG: log });
  clients.push(client);
  await client.start();
  const store = new FileStore({ folder: join(dir, "recipes"), policy: "standard", now: () => 7 });
  let clock = 0;
  const patience = { now: () => clock, sleep: async (ms: number) => { clock += ms; } };
  const steps = createStepsServer({ driver: agentBrowserDriver(client), upstream: client, store, now: () => 7, id: () => "rec-1", patience });
  let id = 0;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const reply = await steps.handle({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) as { result: { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean } };
    return reply.result;
  };
  return { steps, store, call };
}
const actions = () => {
  try {
    return readFileSync(log, "utf8").trim().split("\n").map((line) => line.split(" ")[0]);
  } catch {
    return [];
  }
};

describe("the steps MCP server", () => {
  it("lists the driver's own tools beside the five steps tools", async () => {
    const { steps } = await server();
    const listed = await steps.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      "agent_browser_open", "agent_browser_snapshot", "agent_browser_get_url", "agent_browser_click", "agent_browser_fill",
      "steps_start", "steps_stop", "steps_list", "steps_run", "steps_repair",
    ]);
    expect(STEPS_TOOLS.every((tool) => tool.description && tool.inputSchema.type === "object")).toBe(true);
    expect(await steps.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} })).toMatchObject({ result: { serverInfo: { name: "agent-steps" } } });
    expect(await steps.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
  });

  it("records what the agent does through it, then repeats it with no model", async () => {
    const { call, store } = await server();
    expect((await call("steps_start", { name: "Find {animal} billing", inputs: { animal: "cats" } })).isError).toBeUndefined();
    await call("agent_browser_open", { url: "https://example.com/" });
    await call("agent_browser_snapshot");
    await call("agent_browser_fill", { selector: "@e10", text: "cats" });
    await call("agent_browser_click", { selector: "@e11" });
    const stopped = await call("steps_stop", { checks: ["Signed in"] });
    expect(stopped.content[0]!.text).toBe('Saved "Find {animal} billing": 3 steps, revision 1.');
    expect(store.list()).toHaveLength(1);
    expect((await call("steps_list")).structuredContent).toEqual({ recipes: [{ name: "Find {animal} billing", id: "rec-1", revision: 1, steps: 3, inputs: ["animal"], checks: ["Signed in"] }] });

    const ran = await call("steps_run", { name: "find {animal} billing", inputs: { animal: "owls" } });
    expect(ran.structuredContent).toEqual({ outcome: "done", steps: 3 });
    expect(readFileSync(log, "utf8")).toContain('agent_browser_fill {"text":"owls","selector":"@e20"}');
  });

  it("says where a run failed, and repairs the recipe from that step as its next revision", async () => {
    const first = await server();
    await first.call("steps_start", { name: "Open billing" });
    await first.call("agent_browser_snapshot");
    await first.call("agent_browser_click", { selector: "@e11" });
    await first.call("steps_stop");

    const { call, store } = await server("Invoices,Help");
    const failed = await call("steps_run", { name: "Open billing" });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({ outcome: "failed", at: 1, done: 0, error: 'no "Billing" (link) on the page' });
    expect(failed.content[0]!.text).toContain("call steps_repair with at=1");

    await call("steps_repair", { name: "Open billing", at: 1 });
    const page = await call("agent_browser_snapshot");
    await call("agent_browser_click", { selector: `@${/link "Invoices" \[ref=(e\d+)\]/u.exec(page.content[0]!.text)![1]}` });
    expect((await call("steps_stop")).content[0]!.text).toBe('Saved "Open billing": 1 steps, revision 2.');
    expect(store.list()[0]).toMatchObject({ id: "rec-1", revision: 2, steps: [{ target: { role: "link", name: "Invoices" } }] });
    expect((await call("steps_run", { name: "Open billing" })).structuredContent).toEqual({ outcome: "done", steps: 1 });
  });

  it("refuses to save what it must not repeat, and says why", async () => {
    const { call } = await server("Delete account");
    await call("steps_start", { name: "Close my account" });
    await call("agent_browser_snapshot");
    await call("agent_browser_click", { selector: "@e11" });
    expect(await call("steps_stop")).toMatchObject({ isError: true, structuredContent: { saved: false, reason: "final-action" } });
    expect(await call("steps_run", { name: "Close my account" })).toMatchObject({ isError: true });
    expect(actions()).toEqual(["agent_browser_click"]);
  });

  it("answers one recording at a time", async () => {
    const { call } = await server();
    await call("steps_start", { name: "a" });
    expect((await call("steps_start", { name: "b" })).content[0]!.text).toBe('Already recording "a". Call steps_stop first.');
    expect((await call("steps_stop", { discard: true })).content[0]!.text).toBe("Recording dropped.");
    expect((await call("steps_stop")).isError).toBe(true);
  });
});

describe("agent-steps mcp", () => {
  it("parses its command line", () => {
    expect(parseArgs(["mcp", "--driver", "cua", "--store", "/tmp/r", "--", "cua-driver", "mcp"])).toEqual({ driver: "cua", store: "/tmp/r", command: "cua-driver", args: ["mcp"] });
    expect(parseArgs(["mcp", "--", "agent-browser", "mcp"])).toMatchObject({ driver: "agent-browser", command: "agent-browser" });
    expect(parseArgs(["mcp"])).toMatch(/^usage/);
    expect(parseArgs(["mcp", "--driver", "selenium", "--", "x"])).toMatch(/^usage/);
  });

  it("serves the driver's tools and its own over stdio", async () => {
    const child = spawn(process.execPath, [BIN, "mcp", "--store", join(dir, "recipes"), "--", process.execPath, FAKE], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    await expect.poll(() => out.includes("\n"), { timeout: 10_000 }).toBe(true);
    child.stdin.end();
    child.kill();
    const names = (JSON.parse(out.split("\n")[0]!) as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name);
    expect(names).toContain("agent_browser_click");
    expect(names).toContain("steps_run");
  });
});
