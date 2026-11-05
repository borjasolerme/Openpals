import { afterEach, describe, expect, it, vi } from "vitest";
import { connectServer, currentPlace, disconnectServer, onPlaceChanged } from "./place";

afterEach(() => { vi.unstubAllGlobals(); });

describe("where the bots live", () => {
  it("has no place of its own in a browser, where the page is the place", async () => {
    vi.stubGlobal("window", {});
    expect(await currentPlace()).toBeNull();
    expect(await connectServer("https://bots.example.com/pair#code=ABCD")).toEqual({ ok: false, error: "desktop-only" });
    await expect(disconnectServer()).resolves.toBeUndefined();
    expect(onPlaceChanged(() => {})()).toBeUndefined();
  });

  it("asks the desktop app, which pairs, forgets and says when the place changed", async () => {
    const server = { kind: "server", url: "https://bots.example.com", label: "Bots" } as const;
    let listener: ((place: { kind: "local" } | typeof server) => void) | undefined;
    const stop = vi.fn();
    const place = {
      current: vi.fn(async () => server),
      connect: vi.fn(async () => ({ ok: true as const })),
      disconnect: vi.fn(async () => {}),
      onChanged: vi.fn((callback: typeof listener) => { listener = callback; return stop; }),
    };
    vi.stubGlobal("window", { ogb: { place } });

    expect(await currentPlace()).toEqual(server);
    expect(await connectServer("https://bots.example.com/pair#code=ABCD")).toEqual({ ok: true });
    expect(place.connect).toHaveBeenCalledWith("https://bots.example.com/pair#code=ABCD");
    await disconnectServer();
    expect(place.disconnect).toHaveBeenCalledOnce();

    const seen: unknown[] = [];
    const unsubscribe = onPlaceChanged((next) => seen.push(next));
    listener?.({ kind: "local" });
    unsubscribe();
    expect(seen).toEqual([{ kind: "local" }]);
    expect(stop).toHaveBeenCalledOnce();
  });
});
