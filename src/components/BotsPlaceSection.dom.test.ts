// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { BotsPlaceSection } from "./BotsPlaceSection";

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
  await act(async () => root!.render(createElement(BotsPlaceSection)));
  await act(async () => { await Promise.resolve(); });
}
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent?.includes(label));

describe("Settings → Where your bots live", () => {
  it("is shown only in the desktop app", async () => {
    delete (window as { ogb?: unknown }).ogb;
    await mount();
    expect(host.innerHTML).toBe("");
  });

  it("names this computer and opens the server setup to connect", async () => {
    await mount();
    expect(host.textContent).toContain("Where your bots live");
    expect(host.textContent).toContain("This computer");
    await act(async () => button("Connect to a server")!.click());
    expect(host.querySelector("[data-server-setup-flow]")).not.toBeNull();
    await act(async () => button("Cancel")!.click());
    expect(host.querySelector("[data-server-setup-flow]")).toBeNull();
  });

  it("names the server the bots live on and goes back to this computer", async () => {
    now = { kind: "server", url: "https://bots.example.com", label: "Office server" };
    await mount();
    expect(host.textContent).toContain("Office server");
    expect(host.textContent).toContain("https://bots.example.com");
    await act(async () => button("Disconnect")!.click());
    expect(place.disconnect).toHaveBeenCalledOnce();
    await act(async () => changed?.({ kind: "local" }));
    expect(host.textContent).toContain("This computer");
  });
});
