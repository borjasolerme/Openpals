// A bot whose work computer is a lent one with its person's Chrome connected: its agent_browser_* tools drive that Chrome,
// on that computer, without the mouse. Served from POST /api/internal/browser/mcp instead of the server's own browser; each
// list or call reaches the computer as one job (browser_tools / browser_call), where agent-browser runs attached to Chrome.
import { LENT_BROWSER_FALLBACK } from "./lent-screen-guidance.ts";
import { chromeNotConnected, type SharedComputerOperation } from "./shared-computers.ts";

type ToolResult = { content: Array<{ type: string; [key: string]: unknown }>; isError?: boolean };
type Tool = { name: string; description?: string; inputSchema: Record<string, unknown> };

/** What one browser call there did, for whoever keeps the steps (saved steps can replay what a bot did there). */
export interface LentBrowserStep { tool: string; arguments: Record<string, unknown>; result: ToolResult }

export interface LentBrowserRpcDeps {
  computerId: string;
  /** The bot: its own tabs in the person's Chrome. */
  botId: string;
  /** The computer's name and kind while it is online, and whether its person's Chrome is connected; null when it is away. */
  chrome(): { name: string; device: "PC" | "Mac" | "computer"; on: boolean } | null;
  away(): string;
  request(operation: SharedComputerOperation): Promise<unknown>;
  assertActive(): void;
  onStep?(step: LentBrowserStep): void;
}

/** Tools a call in the person's own Chrome can't take: uploads name files on the server, which aren't on that computer. */
const NOT_THERE = new Set(["agent_browser_upload"]);
const BROWSER_TOOL = /^agent_browser_[a-z_]{1,60}$/;
const text = (value: string, isError = false): ToolResult => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });
/** A browser call that failed there leaves the screen tools as they are: the bot is told to do the page with them. */
const fallBack = (result: ToolResult): ToolResult => ({ ...result, isError: true, content: [...result.content, { type: "text", text: LENT_BROWSER_FALLBACK }] });

export async function lentBrowserRpc(
  request: { method?: unknown; params?: unknown } | null | undefined,
  deps: LentBrowserRpcDeps,
): Promise<{ tools: Tool[] } | ToolResult> {
  const session = deps.botId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
  if (request?.method === "tools/list") {
    deps.assertActive();
    if (!deps.chrome()?.on) return { tools: [] };
    const listed = await deps.request({ computer_id: deps.computerId, action: "browser_tools", browser_session: session }).catch(() => null) as { tools?: unknown } | null;
    const tools = Array.isArray(listed?.tools) ? listed.tools.filter((tool): tool is Tool => typeof tool?.name === "string" && BROWSER_TOOL.test(tool.name) && !NOT_THERE.has(tool.name)) : [];
    return { tools };
  }
  if (request?.method !== "tools/call") throw Object.assign(new Error("unsupported browser method"), { status: 400 });
  const params = (request.params && typeof request.params === "object" ? request.params : {}) as { name?: unknown; arguments?: unknown };
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
  if (!BROWSER_TOOL.test(name) || NOT_THERE.has(name)) return fallBack(text(`${name || "This tool"} can't be used in the person's own Chrome on a lent computer.`));
  const chrome = deps.chrome();
  // Away (offline, paused): its screen is gone too, so the away text alone. Online with Chrome off: the screen still works.
  if (!chrome) return text(deps.away(), true);
  if (!chrome.on) return fallBack(text(chromeNotConnected(chrome.name, chrome.device)));
  deps.assertActive();
  let result: ToolResult;
  try {
    const value = await deps.request({ computer_id: deps.computerId, action: "browser_call", tool_name: name, arguments: args, browser_session: session });
    result = value && typeof value === "object" && Array.isArray((value as ToolResult).content) ? value as ToolResult : text(JSON.stringify(value));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallBack(text(message || chromeNotConnected(chrome.name, chrome.device)));
  }
  deps.assertActive();
  if (result.isError) return fallBack(result);
  deps.onStep?.({ tool: name, arguments: args, result });
  return result;
}
