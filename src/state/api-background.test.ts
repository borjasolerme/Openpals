import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./store";

afterEach(() => { vi.unstubAllGlobals(); });

describe("api() and background requests", () => {
  it("sends JSON by default, and a caller's own headers as given", async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await api("/api/threads", { background: true });
    await api("/api/upload", { method: "PUT", headers: { "x-omb-sha256": "abc" } });
    const sent = fetch.mock.calls.map(([, init]) => new Headers(init?.headers));
    expect(sent[0].get("content-type")).toBe("application/json");
    expect(sent[1].get("content-type")).toBeNull();
    expect(sent[1].get("x-omb-sha256")).toBe("abc");
  });

  it("holds background requests while the page is hidden, one per path, and sends them once it shows", async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const page = hiddenPage();
    vi.stubGlobal("document", page);
    // A poll that ticks twice while hidden asks once; other paths each wait; the person's own request goes at once.
    const held = [api("/api/limit-resets", { background: true }), api("/api/limit-resets", { background: true }), api("/api/inbox", { background: true }),
      api("/api/inbox/a/read", { method: "POST", background: true })];
    await api("/api/threads");
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(["/api/threads"]);
    page.show();
    await Promise.all(held);
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(["/api/threads", "/api/limit-resets", "/api/inbox", "/api/inbox/a/read"]);
    expect(page.listeners.size).toBe(0);
  });

  it("lets a caller's signal end the wait of a held background request", async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const page = hiddenPage();
    vi.stubGlobal("document", page);
    const controller = new AbortController();
    const mine = api("/api/bots", { background: true, signal: controller.signal });
    controller.abort();
    await expect(mine).rejects.toMatchObject({ name: "AbortError" });
    page.show();
    expect(fetch).not.toHaveBeenCalled();
  });
});

/** A hidden page's `document`, as far as api() reads it, that can be shown. */
function hiddenPage() {
  const listeners = new Set<() => void>();
  const page = {
    visibilityState: "hidden" as DocumentVisibilityState,
    listeners,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
    show() { page.visibilityState = "visible"; for (const listener of Array.from(listeners)) listener(); },
  };
  return page;
}
