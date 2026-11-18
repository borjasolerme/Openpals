import { describe, expect, it, vi } from "vitest";

import { createLentBrowserRoutes } from "./lent-browser.ts";
import { PASS, type RouteContext } from "./table.ts";

function call(handler: ReturnType<typeof createLentBrowserRoutes>, body: unknown, auth: { kind: string } = { kind: "loopback" }, path = "/api/desktop/lent-browser") {
  const answers: Array<{ status: number; body: unknown }> = [];
  const ctx = {
    req: {}, res: {}, path, method: "POST", auth,
    json: (_res: unknown, status: number, value: unknown) => { answers.push({ status, body: value }); },
    readBody: async () => body,
  } as unknown as RouteContext;
  return Promise.resolve(handler(ctx)).then((value) => ({ value, answer: answers[0] }));
}

describe("a bot's browser call in the person's Chrome on this lent computer", () => {
  it("runs a list or a browser tool for main on this machine, by its key", async () => {
    const run = vi.fn(async (_key: string, method: string) => (method === "tools/list" ? { tools: [] } : { content: [{ type: "text", text: "ok" }] }));
    const routes = createLentBrowserRoutes({ run });
    expect((await call(routes, { key: "abcd1234-bot", method: "tools/list" })).answer).toEqual({ status: 200, body: { result: { tools: [] } } });
    expect((await call(routes, { key: "abcd1234-bot", method: "tools/call", params: { name: "agent_browser_open", arguments: { url: "https://example.com" } } })).answer?.status).toBe(200);
    expect(run.mock.calls).toEqual([["abcd1234-bot", "tools/list", {}], ["abcd1234-bot", "tools/call", { name: "agent_browser_open", arguments: { url: "https://example.com" } }]]);
  });

  it("refuses anyone but this machine, an upload, a tool that isn't the browser's, and other paths pass", async () => {
    const run = vi.fn();
    const routes = createLentBrowserRoutes({ run });
    expect((await call(routes, { key: "k", method: "tools/list" }, { kind: "session" })).answer?.status).toBe(403);
    expect((await call(routes, { key: "k", method: "tools/call", params: { name: "agent_browser_upload", arguments: {} } })).answer?.status).toBe(400);
    expect((await call(routes, { key: "k", method: "tools/call", params: { name: "run_command", arguments: {} } })).answer?.status).toBe(400);
    expect((await call(routes, {}, { kind: "loopback" }, "/api/other")).value).toBe(PASS);
    expect(run).not.toHaveBeenCalled();
  });

  it("answers a failure as a tool error the bot reads", async () => {
    const routes = createLentBrowserRoutes({ run: async () => { throw new Error("No running Chrome with remote debugging"); } });
    expect((await call(routes, { key: "k", method: "tools/list" })).answer?.body).toEqual({ result: { isError: true, content: [{ type: "text", text: "No running Chrome with remote debugging" }] } });
  });
});
