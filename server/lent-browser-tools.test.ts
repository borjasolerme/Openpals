import { describe, expect, it, vi } from "vitest";

import { lentBrowserRpc, type LentBrowserRpcDeps } from "./lent-browser-tools.ts";
import { LENT_BROWSER_FALLBACK } from "./lent-screen-guidance.ts";
import { chromeNotConnected, sharedComputerOperation, sharedComputerScopeRefusal } from "./shared-computers.ts";

const COMPUTER = "11111111-1111-4111-8111-111111111111";
const deps = (extra: Partial<LentBrowserRpcDeps> = {}): LentBrowserRpcDeps => ({
  computerId: COMPUTER, botId: "bot-1", chrome: () => ({ name: "Borja mini", device: "Mac", on: true }), away: () => "Borja mini is offline.",
  request: vi.fn(async () => ({ content: [{ type: "text", text: "opened" }] })), assertActive: () => {}, ...extra,
});

describe("a bot browsing in the person's Chrome on a lent computer", () => {
  it("lists that computer's browser tools, without uploads", async () => {
    const request = vi.fn(async () => ({ tools: [{ name: "agent_browser_open", inputSchema: {} }, { name: "agent_browser_upload", inputSchema: {} }, { name: "click", inputSchema: {} }] }));
    expect(await lentBrowserRpc({ method: "tools/list" }, deps({ request }))).toEqual({ tools: [{ name: "agent_browser_open", inputSchema: {} }] });
    expect(request).toHaveBeenCalledWith({ computer_id: COMPUTER, action: "browser_tools", browser_session: "bot-1" });
  });

  it("sends each call there as one browser_call in the bot's own tabs, and hands each step to whoever keeps them", async () => {
    const onStep = vi.fn();
    const request = vi.fn(async () => ({ content: [{ type: "text", text: "opened" }] }));
    const result = await lentBrowserRpc({ method: "tools/call", params: { name: "agent_browser_open", arguments: { url: "https://www.linkedin.com/" } } }, deps({ request, onStep }));
    expect(result).toEqual({ content: [{ type: "text", text: "opened" }] });
    expect(request).toHaveBeenCalledWith({ computer_id: COMPUTER, action: "browser_call", tool_name: "agent_browser_open", arguments: { url: "https://www.linkedin.com/" }, browser_session: "bot-1" });
    expect(onStep).toHaveBeenCalledWith({ tool: "agent_browser_open", arguments: { url: "https://www.linkedin.com/" }, result });
  });

  it("says why when the computer is away, and otherwise sends every failure back to the screen tools", async () => {
    const call = { method: "tools/call", params: { name: "agent_browser_open", arguments: {} } };
    const fallback = { type: "text", text: LENT_BROWSER_FALLBACK };
    expect(await lentBrowserRpc(call, deps({ chrome: () => null }))).toEqual({ content: [{ type: "text", text: "Borja mini is offline." }], isError: true });
    expect(await lentBrowserRpc({ method: "tools/list" }, deps({ chrome: () => null }))).toEqual({ tools: [] });
    const off = deps({ chrome: () => ({ name: "Borja mini", device: "Mac", on: false }) });
    expect(await lentBrowserRpc({ method: "tools/list" }, off)).toEqual({ tools: [] });
    expect(await lentBrowserRpc(call, off)).toEqual({ isError: true, content: [{ type: "text", text: chromeNotConnected("Borja mini", "Mac") }, fallback] });
    expect(off.request).not.toHaveBeenCalled();
    const onStep = vi.fn();
    expect(await lentBrowserRpc(call, deps({ onStep, request: async () => { throw new Error("Allow wasn't clicked in Chrome"); } }))).toEqual({ isError: true, content: [{ type: "text", text: "Allow wasn't clicked in Chrome" }, fallback] });
    expect(await lentBrowserRpc(call, deps({ onStep, request: async () => ({ isError: true, content: [{ type: "text", text: "Element not found" }] }) }))).toEqual({ isError: true, content: [{ type: "text", text: "Element not found" }, fallback] });
    expect(onStep).not.toHaveBeenCalled();
    expect(await lentBrowserRpc({ method: "tools/call", params: { name: "agent_browser_upload", arguments: {} } }, deps())).toMatchObject({ isError: true, content: [expect.anything(), fallback] });
  });

  it("is a job the server queues only for a computer that lends its Chrome, and tells the bot how to turn it on", () => {
    const registration = { id: COMPUTER, name: "Borja mini", environmentId: COMPUTER, folders: [], terminal: false, computer: true, platform: "darwin" as const };
    const call = sharedComputerOperation.parse({ computer_id: COMPUTER, action: "browser_call", tool_name: "agent_browser_open", arguments: {}, browser_session: "bot-1" });
    expect(sharedComputerScopeRefusal(registration, call)).toBe(chromeNotConnected("Borja mini", "Mac"));
    expect(sharedComputerScopeRefusal({ ...registration, chrome: true }, call)).toBeNull();
    expect(chromeNotConnected("Borja mini", "Mac")).toContain("Use my Chrome without the mouse");
    expect(sharedComputerOperation.safeParse({ computer_id: COMPUTER, action: "browser_call", browser_session: "has spaces" }).success).toBe(false);
  });
});
