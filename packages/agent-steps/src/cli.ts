// agent-steps mcp [--driver agent-browser|cua] [--store <folder>] -- <command> [args...]
// Starts the driver's own MCP server as a child and serves it with the saved-steps tools added, on stdio.
import { homedir } from "node:os";
import { join } from "node:path";
import { cuaDriver } from "./cua/driver.ts";
import { StdioMcpClient } from "./mcp/client.ts";
import { createStepsServer, serveStdio } from "./mcp/server.ts";
import { FileStore } from "./store.ts";
import { agentBrowserDriver } from "./web/driver.ts";

const USAGE = "usage: agent-steps mcp [--driver agent-browser|cua] [--store <folder>] -- <command> [args...]\n"
  + "  e.g. agent-steps mcp --driver agent-browser -- agent-browser mcp";

export interface CliOptions { driver: "agent-browser" | "cua"; store: string; command: string; args: string[] }

export function parseArgs(argv: readonly string[]): CliOptions | string {
  if (argv[0] !== "mcp") return USAGE;
  const split = argv.indexOf("--");
  const own = split === -1 ? argv.slice(1) : argv.slice(1, split);
  const child = split === -1 ? [] : argv.slice(split + 1);
  let driver: CliOptions["driver"] = "agent-browser";
  let store = join(homedir(), ".agent-steps", "recipes");
  for (let index = 0; index < own.length; index++) {
    const flag = own[index];
    const value = own[index + 1];
    if (flag === "--driver" && (value === "agent-browser" || value === "cua")) driver = value;
    else if (flag === "--store" && value) store = value;
    else return USAGE;
    index++;
  }
  const [command, ...args] = child;
  if (!command) return USAGE;
  return { driver, store, command, args };
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (typeof options === "string") {
    process.stderr.write(`${options}\n`);
    process.exitCode = 2;
    return;
  }
  const client = new StdioMcpClient(options.command, options.args);
  await client.start();
  const driver = options.driver === "cua" ? cuaDriver(client) : agentBrowserDriver(client);
  const server = createStepsServer({ driver, upstream: client, store: new FileStore({ folder: options.store, policy: "standard" }) });
  serveStdio(server.handle);
  process.stdin.on("end", () => client.close());
}
