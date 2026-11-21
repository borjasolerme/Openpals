// The grant key binds approval to the instance, the exact MCP server/tool and that server's config, so editing the server invalidates it.
import { createHash } from "node:crypto";

import { isReadOnlyTool } from "../shared/outbound.ts";

export interface ProviderMcpTool {
  server: string;
  tool: string;
}

/** Provider-facing MCP tool names are mcp__<server>__<tool>. */
export function providerMcpTool(name: string): ProviderMcpTool | null {
  if (!name.startsWith("mcp__")) return null;
  const parts = name.split("__");
  if (parts.length < 3 || parts[0] !== "mcp" || !parts[1] || !parts.slice(2).join("__")) return null;
  return { server: parts[1], tool: parts.slice(2).join("__") };
}

export function providerToolAllowKey(
  providerInstanceId: string,
  name: string,
  serverConfig: unknown,
): string | null {
  const parsed = providerMcpTool(name);
  if (!parsed || !providerInstanceId || !isReadOnlyTool(name)) return null;
  const fingerprint = createHash("sha256").update(JSON.stringify(serverConfig)).digest("hex").slice(0, 16);
  return `provider-tool:${providerInstanceId}:${parsed.server}:${parsed.tool}:${fingerprint}`;
}

/** Whether `key` is saved for this turn: in the thread's own list, or in its bot's, which Settings → Access shows. A
 * grant reaches every conversation of the bot, one opened before it was saved and one whose own list was reset alike;
 * removing it there takes it from both. */
export function savedToolGrant(key: string | null, ...lists: Array<readonly string[] | undefined>): boolean {
  return key !== null && lists.some((list) => list?.includes(key) === true);
}
