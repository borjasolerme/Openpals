// Which requests and turns saved steps may learn from: the person's own words, and no tool the journal does not see.
import { cuaOwns, webOwns } from "agent-steps";
import type { Message } from "../store.ts";

export function personTextRequest(message: Message): boolean {
  if (message.role !== "user" || message.kind !== "text") return false;
  const text = message.text ?? "";
  if (!text.trim() || text.includes("<attached-image") || text.includes("<attached-file")) return false;
  if (message.attachments?.length) return false;
  return !(message.replyToId || message.reaction || message.fromApp || message.pointed || message.dataContext || message.peerAsk
    || message.via || message.relayed || message.setupRequest || message.steered || message.aside);
}

const HARMLESS_TOOLS: ReadonlySet<string> = new Set([
  "Read", "Glob", "Grep", "LS", "ToolSearch", "TodoWrite", "WebSearch", "WebFetch", "mcp__agents__select_computer", "select_computer", "web_search",
]);
const unprefixed = (name: string, prefixes: readonly string[]): string => {
  const prefix = prefixes.find((candidate) => name.startsWith(candidate));
  return prefix ? name.slice(prefix.length) : name;
};

/** The computer's and the browser's tools are journaled; any other tool did work no saved step would repeat. */
const journaledTool = (name: string): boolean =>
  name.startsWith("mcp__computer__") || cuaOwns(unprefixed(name, ["computer_"])) || webOwns(unprefixed(name, ["mcp__browser__", "browser_"]));

export function otherToolsHarmless(lines: readonly Message[]): boolean {
  return lines.every(({ tool }) => tool?.itemId === undefined || journaledTool(tool.name) || HARMLESS_TOOLS.has(tool.name));
}
