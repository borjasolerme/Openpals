import { afterEach, describe, expect, it, vi } from "vitest";
import { connectServer, currentPlace, disconnectServer, isServerPairingLink, onPlaceChanged } from "./place";

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

describe("server pairing links", () => {
  it.each([
    "https://bots.example.com/pair#code=ABCD-EFGH-JKLM",
    " https://custom.example.com:8443/pair/#code=ABCD%2DEFGH%2DJKLM ",
    "https://random.trycloudflare.com/pair#code=ABCDEFGHJKLM",
  ])("accepts a complete HTTPS link: %s", (link) => {
    expect(isServerPairingLink(link)).toBe(true);
  });

  it.each([
    "",
    "ABCD-EFGH-JKLM",
    "http://bots.example.com/pair#code=ABCD-EFGH-JKLM",
    "https:example.com/pair#code=ABCD-EFGH-JKLM",
    "https://user:secret@bots.example.com/pair#code=ABCD-EFGH-JKLM",
    "https://bots.example.com",
    "https://bots.example.com/pair",
    "https://bots.example.com/pair#code=",
    "https://bots.example.com/pair#code=%20",
    "https://bots.example.com/pair#code=%",
    "https://bots.example.com/other#code=ABCD-EFGH-JKLM",
    "https://bots.example.com/pair?code=ABCD-EFGH-JKLM",
    "https://bots.example.com/pair?code=secret#code=ABCD-EFGH-JKLM",
    "https://bots.example.com/pair#code=ABCD EFGH JKLM",
    "https://bots.example.com\\@other.example/pair#code=ABCD-EFGH-JKLM",
    "openmausbot://pair?code=123456",
  ])("rejects an incomplete, malformed or insecure link: %s", (link) => {
    expect(isServerPairingLink(link)).toBe(false);
  });
});
