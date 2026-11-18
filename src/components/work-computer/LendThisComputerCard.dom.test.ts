// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { LendingState } from "@/lib/lending";

const { LendThisComputerCard } = await import("./LendThisComputerCard");

const LINK = "https://boat.example/pair#code=ABCD-EFGH-JKLM&lend=1";
const base = (extra: Partial<LendingState> = {}): LendingState => ({
  on: false, paused: false, name: "Mac mini", server: null, state: "off", targets: [], busy: null, terminal: false, lendsScreen: true,
  screen: { ready: true, lent: true, reason: null, fix: null }, folders: [], defaultName: "Mac mini", device: "Mac", platform: "darwin", openAtLogin: null, chrome: false, chromeCheck: null, ...extra,
});
const lent = base({
  on: true, server: "Boat server, Ana's server", state: "online",
  targets: [
    { id: "t-boat", serverName: "Boat server", paused: false, state: "online" },
    { id: "t-home", serverName: "Ana's server", paused: false, state: "waiting", problem: "signed-out" },
  ],
});

let host: HTMLDivElement;
let root: Root;
let bridge: Record<string, ReturnType<typeof vi.fn>>;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector(selector) as T | null;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text || item.getAttribute("aria-label") === text);
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const render = async (state: LendingState) => {
  bridge = {
    state: vi.fn(async () => state), onChanged: vi.fn(() => () => {}),
    addLink: vi.fn(async () => lent), removeTarget: vi.fn(async () => base()), pauseTarget: vi.fn(async () => state),
    resumeTarget: vi.fn(async () => state), turnOn: vi.fn(async () => state), turnOff: vi.fn(async () => state),
    setChrome: vi.fn(async () => ({ ...state, chrome: false, chromeCheck: { ok: false, error: "No running Chrome with remote debugging" } })),
    openChromeSetup: vi.fn(async () => state),
  };
  (window as unknown as { ogb: unknown }).ogb = { lending: bridge };
  await act(async () => root.render(createElement(LendThisComputerCard)));
  await settle();
};

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (window as unknown as { ogb?: unknown }).ogb;
});

it("with no server yet, asks only for the link from Add a computer, and refuses anything else", async () => {
  await render(base());
  expect(q("[data-lend-this-computer]")?.textContent).toContain("Let bots use this Mac");
  expect(q("[data-lending-target]")).toBeNull();
  const input = q<HTMLInputElement>("#lending-link")!;
  await type(input, "https://boat.example/pair#code=ABCD-EFGH-JKLM");
  await act(async () => { q<HTMLFormElement>("[data-lending-add]")!.requestSubmit(); });
  expect(q("[data-lending-add] [role=alert]")?.textContent).toContain("isn't a link from “Add a computer”");
  expect(bridge.addLink).not.toHaveBeenCalled();
  await type(input, LINK);
  await act(async () => { q<HTMLFormElement>("[data-lending-add]")!.requestSubmit(); });
  await settle();
  expect(bridge.addLink).toHaveBeenCalledWith(LINK);
  expect([...document.querySelectorAll("[data-lending-target]")].map((row) => row.getAttribute("data-lending-phase"))).toEqual(["online", "problem"]);
});

it("lists each server with where it stands, says what to do about a problem, and pauses or removes one", async () => {
  await render(lent);
  const rows = [...document.querySelectorAll("[data-lending-target]")];
  expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Boat server"), expect.stringContaining("Ana's server")]);
  expect(rows[1]!.textContent).toContain("Make a new one in “Add a computer”");
  await act(async () => { rows[0]!.querySelector<HTMLButtonElement>("button")!.click(); });
  expect(bridge.pauseTarget).toHaveBeenCalledWith("t-boat");
  await act(async () => { button("Remove Ana's server")!.click(); });
  expect(bridge.removeTarget).toHaveBeenCalledWith("t-home");
});

it("Use my Chrome without the mouse shows the one-time step, opens it in Chrome, and says why it isn't on yet", async () => {
  await render(lent);
  expect(q("[data-lending-chrome]")?.getAttribute("data-lending-chrome")).toBe("off");
  expect([...document.querySelectorAll("[data-lending-chrome-steps] li")].map((item) => item.textContent)).toEqual([
    "Open Chrome's remote debugging page with the button below.",
    "Tick \"Allow remote debugging for this browser instance\".",
    "Turn this switch on, then click Allow when Chrome asks.",
  ]);
  await act(async () => { button("Open the page in Chrome")!.click(); });
  expect(bridge.openChromeSetup).toHaveBeenCalled();
  await act(async () => { button("Use my Chrome without the mouse")!.click(); });
  await settle();
  expect(bridge.setChrome).toHaveBeenCalledWith(true);
  expect(q("[data-lending-chrome]")?.getAttribute("data-lending-chrome")).toBe("failed");
  expect(document.body.textContent).toContain("Couldn't reach Chrome yet: No running Chrome with remote debugging");
});

it("once Chrome is connected, says so and offers only turning it off", async () => {
  await render({ ...lent, chrome: true });
  expect(q("[data-lending-chrome]")?.getAttribute("data-lending-chrome")).toBe("on");
  expect(document.body.textContent).toContain("Connected ✓");
  expect(q("[data-lending-chrome-steps]")).toBeNull();
});
