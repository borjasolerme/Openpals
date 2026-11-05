// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { RemoteComputerSection } from "./RemoteComputerSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Place = { kind: "local" } | { kind: "server"; url: string; label: string };
let host: HTMLDivElement, root: Root | null = null;
let now: Place;
let changed: ((place: Place) => void) | undefined;
const place = {
  current: vi.fn(async () => now),
  connect: vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })),
  disconnect: vi.fn(async () => {}),
  onChanged: vi.fn((callback: (place: Place) => void) => { changed = callback; return () => { changed = undefined; }; }),
};

beforeEach(() => {
  setLocale("en");
  now = { kind: "local" };
  vi.clearAllMocks();
  Object.assign(window, { ogb: { place } });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); delete (window as { ogb?: unknown }).ogb; });

async function mount() {
  root = createRoot(host);
  await act(async () => root!.render(createElement(RemoteComputerSection)));
  await act(async () => { await Promise.resolve(); });
}

async function submit(link: string) {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, link);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { host.querySelector("form")!.requestSubmit(); });
}

describe("connecting this app to a server", () => {
  it("pairs from a full pairing link and shows what the app refused", async () => {
    place.connect.mockResolvedValueOnce({ ok: false, error: "That pairing code has expired." });
    await mount();
    await submit("https://bots.example.com/pair#code=ABCD-EFGH-JKLM");
    expect(place.connect).toHaveBeenCalledWith("https://bots.example.com/pair#code=ABCD-EFGH-JKLM");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("That pairing code has expired.");
  });

  it("refuses a link without its code before asking the app", async () => {
    await mount();
    await submit("https://bots.example.com/pair");
    expect(place.connect).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Paste a full HTTPS server pairing link");
  });

  it("names the server the bots live on and goes back to this computer", async () => {
    now = { kind: "server", url: "https://bots.example.com", label: "Office server" };
    await mount();
    expect(host.textContent).toContain("Connected to Office server");
    expect(host.textContent).toContain("https://bots.example.com");
    const disconnect = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Disconnect"));
    await act(async () => disconnect!.click());
    expect(place.disconnect).toHaveBeenCalledOnce();
    await act(async () => changed?.({ kind: "local" }));
    expect(host.querySelector("form")).not.toBeNull();
  });
});
