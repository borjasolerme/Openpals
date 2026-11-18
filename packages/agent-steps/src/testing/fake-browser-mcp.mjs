// A stand-in for agent-browser's MCP server: a page with a search box and links, refs renumbered on every snapshot.
// FAKE_LINKS names the links (comma separated); FAKE_LOG, when set, gets one line per action.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const links = (process.env.FAKE_LINKS ?? "Billing,Help").split(",");
let snapshot = 0;
const send = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const text = (value) => ({ content: [{ type: "text", text: value }] });
const TOOLS = ["open", "snapshot", "get_url", "click", "fill"].map((name) => ({ name: `agent_browser_${name}`, inputSchema: { type: "object" } }));

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake-browser", version: "1" } } });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method !== "tools/call") return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  const { name, arguments: args } = params;
  if (name === "agent_browser_snapshot") {
    snapshot++;
    const lines = [`- searchbox "Search" [ref=e${snapshot}0]`, ...links.map((link, index) => `- link "${link}" [ref=e${snapshot}${index + 1}]`), "- text: Signed in"];
    return send({ jsonrpc: "2.0", id, result: text(lines.join("\n")) });
  }
  if (name === "agent_browser_get_url") return send({ jsonrpc: "2.0", id, result: text("https://example.com/") });
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${name} ${JSON.stringify(args)}\n`);
  return send({ jsonrpc: "2.0", id, result: text("Done") });
});
