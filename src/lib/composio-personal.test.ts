import { describe, expect, it, vi } from "vitest";
import { looksLikeComposioPersonalKey, saveComposioPersonalKey } from "./composio-personal";

vi.mock("@/state/store", () => ({ api: vi.fn() }));

function fakeServer(existing: string[], probe: { ok: boolean; error?: string }) {
  const calls: Array<[string, string, unknown]> = [];
  const request = vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    calls.push([init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined]);
    if (path === "/api/mcp/servers" && !init?.method) return { servers: existing.map((name) => ({ name })) };
    if (path.endsWith("/test")) return probe;
    return {};
  });
  return { calls, request: request as never };
}

const server = { type: "http", url: "https://connect.composio.dev/mcp", headers: { "x-consumer-api-key": "ck_abc" } };

describe("a personal Composio key", () => {
  it("looks like ck_…", () => {
    expect(looksLikeComposioPersonalKey(" ck_abc ")).toBe(true);
    expect(looksLikeComposioPersonalKey("ak_abc")).toBe(false);
    expect(looksLikeComposioPersonalKey("ck_ab c")).toBe(false);
  });

  it("is saved as the composio-personal MCP server and switched on once Composio accepts it", async () => {
    const { calls, request } = fakeServer([], { ok: true });
    expect(await saveComposioPersonalKey(" ck_abc ", request)).toEqual({ ok: true });
    expect(calls).toEqual([
      ["GET", "/api/mcp/servers", undefined],
      ["POST", "/api/mcp/servers", { name: "composio-personal", ...server }],
      ["POST", "/api/mcp/servers/composio-personal/test", {}],
      ["PATCH", "/api/mcp/servers/composio-personal", { enabled: true }],
    ]);
  });

  it("replaces the saved key, and stays off when Composio refuses it", async () => {
    const { calls, request } = fakeServer(["composio-personal"], { ok: false, error: "401 Unauthorized" });
    expect(await saveComposioPersonalKey("ck_abc", request)).toEqual({ ok: false, error: "401 Unauthorized" });
    expect(calls.map(([method, path]) => `${method} ${path}`)).toEqual([
      "GET /api/mcp/servers", "PUT /api/mcp/servers/composio-personal", "POST /api/mcp/servers/composio-personal/test",
    ]);
    expect(calls[1]![2]).toEqual(server);
  });
});
