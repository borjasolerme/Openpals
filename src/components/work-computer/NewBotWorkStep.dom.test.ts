// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fx = vi.hoisted(() => ({
  step: { type: "newBot" as const },
  dispatch: vi.fn(),
  boat: false,
  computers: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ path: string; method: string; body?: unknown }>,
  saved: [] as Array<[string, string]>,
  pairing: { code: "ABCD-EFGH-JKLM", url: "https://boat.example/pair#code=ABCD-EFGH-JKLM", expiresAt: Date.now() + 10 * 60_000, hint: null },
}));
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  const api = async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    fx.calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/api/work-computers") return { computers: fx.computers };
    if (path === "/api/auth/pairing") return fx.pairing;
    if (path.endsWith("/test")) return { ok: true, image: { mimeType: "image/png", data: "c2NyZWVu" } };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return {
    ...actual,
    api,
    useStore: () => ({
      state: { ...actual.initialState, config: { ...actual.initialState.config, box: { configured: fx.boat } }, newBotStep: fx.step, botCreationPending: false },
      dispatch: fx.dispatch,
    }),
  };
});
vi.mock("../keys/key-save", async (original) => {
  const actual = await original<typeof import("../keys/key-save")>();
  return { ...actual, saveCredential: async (id: string, value: string) => { fx.saved.push([id, value]); return { box: { configured: true } }; } };
});

const { NewBotWorkStep } = await import("./NewBotWorkStep");

let host: HTMLDivElement;
let root: Root;
const mac = (extra: Record<string, unknown> = {}) => ({
  id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", name: "Mac mini", platform: "darwin", online: true, busy: false, lent: true, paused: false,
  lastSeenAt: Date.now(), lastUsedAt: null, scopes: { folders: 0, terminal: false, screen: true }, ...extra,
});
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector(selector) as T | null;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text));
const click = async (element: HTMLElement | null | undefined) => { expect(element).toBeTruthy(); await act(async () => { element!.click(); }); await settle(); };
const created = () => fx.dispatch.mock.calls.map(([action]) => action).find((action) => action.type === "newBot");

beforeEach(async () => {
  setLocale("en");
  fx.dispatch.mockReset();
  fx.boat = false;
  fx.computers = [];
  fx.calls = [];
  fx.saved = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const open = async () => { await act(async () => root.render(createElement(NewBotWorkStep))); await settle(); };

it("asks where the bot works with three cards, and makes it on the server itself by default when there is no Boat key", async () => {
  await open();
  expect(q("[data-new-bot-work-step] h2")?.textContent).toBe("Where does this bot work?");
  expect([...document.querySelectorAll("[data-work-computer-picker] [role=group] > button")].map((card) => card.getAttribute("data-testid")))
    .toEqual(["work-boat", "work-mac", "work-server"]);
  expect(q("[data-testid=work-server]")?.getAttribute("aria-pressed")).toBe("true");
  await click(button("Create bot"));
  expect(created()).toEqual({ type: "newBot", work: { computer: "browser" } });
});

it("without a Boat key, Boat explains itself, links to boat.dev, saves the key like Settings and is then chosen", async () => {
  await open();
  await click(q("[data-testid=work-boat]"));
  const panel = q("[data-boat-key-panel]")!;
  expect(panel.textContent).toContain("paid service");
  expect(q<HTMLAnchorElement>("[data-boat-key-panel] a")?.href).toBe("https://boat.dev/");
  const input = q<HTMLInputElement>("[data-boat-key-panel] input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "not a key");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button("Save key"));
  expect(q("[data-boat-key-panel] [role=alert]")?.textContent).toContain("starts with boat_");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "boat_fixture123");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button("Save key"));
  expect(fx.saved).toEqual([["box", "boat_fixture123"]]);
  expect(fx.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: { box: { configured: true } } });
  expect(q("[data-testid=work-boat]")?.getAttribute("aria-pressed")).toBe("true");
  await click(button("Create bot"));
  expect(created()).toEqual({ type: "newBot", work: { computer: "cloud", cloudBackend: "box" } });
});

it("with a Boat key, Boat is ready and chosen first", async () => {
  fx.boat = true;
  await open();
  expect(q("[data-testid=work-boat]")?.getAttribute("aria-pressed")).toBe("true");
  expect(q("[data-testid=work-boat]")?.textContent).toContain("Ready");
});

it("lists the connected Macs with their state, and makes the bot work on the one chosen", async () => {
  fx.computers = [mac(), mac({ id: "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", name: "Laptop", online: false, paused: true })];
  await open();
  await click(q("[data-testid=work-mac]"));
  const rows = [...document.querySelectorAll("[data-work-macs] [role=radio]")];
  expect(rows.map((row) => [row.textContent?.includes("Mac mini") ? "Mac mini" : "Laptop", row.querySelector("[data-work-computer-state]")?.getAttribute("data-work-computer-state")]))
    .toEqual([["Mac mini", "online"], ["Laptop", "paused"]]);
  await click(rows[0] as HTMLElement);
  await click(button("Create bot"));
  expect(created()).toEqual({ type: "newBot", work: { computer: "cloud", cloudBackend: "lent", lentComputerId: mac().id } });
});

it("Add a Mac walks the steps: a fresh pairing link with its code and Copy, how to allow, then Connected live and Test connection", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await open();
    await click(q("[data-testid=work-mac]"));
    expect(q("[data-add-mac-guide]")).toBeTruthy();
    expect(q("[data-guide-step='1']")?.getAttribute("aria-current")).toBe("step");
    expect(q<HTMLAnchorElement>("[data-guide-step='1'] a")?.href).toBe("https://github.com/borjasolerme/Openpals#getting-started");
    await click(button("It's installed"));
    expect(q("[data-guide-step='2']")?.getAttribute("aria-current")).toBe("step");
    await click(button("Make a link"));
    expect(fx.calls.find((call) => call.path === "/api/auth/pairing")?.body).toMatchObject({ scopes: ["admin", "client"] });
    expect(q("[data-pairing-link]")?.textContent).toContain(fx.pairing.url);
    expect(q("[data-pairing-link] svg")).toBeTruthy();
    expect(q("[data-guide-step='3']")?.getAttribute("aria-current")).toBe("step");
    await click(button("How to allow"));
    expect(q("[data-allow-steps]")?.textContent).toContain("Accessibility");
    expect(q("[data-waiting-for-mac]")).toBeTruthy();

    fx.computers = [mac()];
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    await settle();
    expect(q("[data-guide-step='4']")?.textContent).toContain("Mac mini is connected ✓");
    await click(button("Test connection"));
    expect(q("[data-connection-test=ok] img")?.getAttribute("src")).toBe("data:image/png;base64,c2NyZWVu");
    await click(button("Use Mac mini"));
    await click(button("Create bot"));
    expect(created()).toEqual({ type: "newBot", work: { computer: "cloud", cloudBackend: "lent", lentComputerId: mac().id } });
  } finally {
    vi.useRealTimers();
  }
});

it("keeps Auto and the other places under More options", async () => {
  await open();
  await click(button("More options"));
  await click([...document.querySelectorAll<HTMLButtonElement>("[role=group][aria-label='More options'] button")][0]);
  await click(button("Create bot"));
  expect(created()).toEqual({ type: "newBot", work: { computer: null } });
});
