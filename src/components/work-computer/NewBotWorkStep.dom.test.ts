// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fx = vi.hoisted(() => ({
  step: { type: "newBot" as const },
  dispatch: vi.fn(),
  browser: false,
  profiles: [] as Array<{ id: string; name: string }>,
  computers: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ path: string; method: string; body?: unknown }>,
  pairing: { id: "pairing-1", code: "ABCD-EFGH-JKLM", url: "https://boat.example/pair#code=ABCD-EFGH-JKLM&lend=1", expiresAt: Date.now() + 10 * 60_000, hint: null },
  /** The open pairings the server lists: the guide's link until it is pasted there. */
  open: [] as Array<{ id: string }>,
}));
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  const api = async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    fx.calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/api/work-computers") return { computers: fx.computers };
    if (path === "/api/auth/pairing" && method === "POST") { fx.open = [{ id: fx.pairing.id }]; return fx.pairing; }
    if (path === "/api/auth/pairing") return { pairings: fx.open };
    if (path === "/api/config" && method === "PATCH") return { browserProfiles: (JSON.parse(String(init!.body)) as { browserProfiles: unknown }).browserProfiles };
    if (path.endsWith("/test")) return { ok: true, image: { mimeType: "image/png", data: "c2NyZWVu" } };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return {
    ...actual,
    api,
    useStore: () => ({
      state: { ...actual.initialState, config: { ...actual.initialState.config, features: { browser: fx.browser }, browserProfiles: fx.profiles }, newBotStep: fx.step, botCreationPending: false },
      dispatch: fx.dispatch,
    }),
  };
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
  fx.browser = false;
  fx.profiles = [];
  fx.computers = [];
  fx.calls = [];
  fx.open = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const open = async () => { await act(async () => root.render(createElement(NewBotWorkStep))); await settle(); };

const choices = () => [...document.querySelectorAll("[data-work-place] [role=radio]")].map((row) => [row.getAttribute("data-panel-choice"), row.getAttribute("aria-checked")]);
const shared = () => document.querySelector<HTMLButtonElement>("[data-panel-row=shared-logins] [role=switch]");

it("asks where the bot works as one list, Your server first and chosen, with no Boat and no More options", async () => {
  await open();
  expect(q("[data-new-bot-work-step] h2")?.textContent).toBe("Where does this bot work?");
  expect(choices()).toEqual([["server", "true"]]);
  expect(document.body.textContent).toContain("Your server");
  expect(document.body.textContent).not.toContain("Boat");
  expect(button("More options")).toBeUndefined();
  await click(button("Create bot"));
  expect(created()).toEqual({ type: "newBot", work: { computer: "browser" } });
});

it("lists each lent computer by its own name and state, and makes the bot work on the one chosen", async () => {
  fx.computers = [mac(), mac({ id: "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", name: "Laptop", online: false, paused: true })];
  await open();
  const rows = [...document.querySelectorAll<HTMLElement>("[data-work-place] [role=radio]")];
  expect(rows.map((row) => row.textContent)).toEqual(["Your serverWhere your bots live. Nothing to set up.", "Mac miniConnected", "LaptopPaused"]);
  await click(rows[1]);
  await click(button("Create bot"));
  expect(created()).toEqual({ type: "newBot", work: { computer: "cloud", cloudBackend: "lent", lentComputerId: mac().id } });
});

it("Add a computer: install, a lend-only link made as step 2 opens, then it says what is missing until the computer is ready", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(3_100); }); await settle(); };
  try {
    await open();
    await click(button("Add a computer"));
    expect(q("[data-add-computer-guide]")?.textContent).toContain("a virtual machine with a desktop");
    expect(q("[data-guide-step='1']")?.getAttribute("aria-current")).toBe("step");
    expect(fx.calls.some((call) => call.path === "/api/auth/pairing")).toBe(false);
    await click(button("It's installed"));
    expect(q("[data-guide-step='2']")?.getAttribute("aria-current")).toBe("step");
    expect(fx.calls.filter((call) => call.path === "/api/auth/pairing" && call.method === "POST").map((call) => call.body)).toEqual([expect.objectContaining({ scopes: ["lend"] })]);
    expect(q("[data-pairing-code]")?.textContent).toContain(fx.pairing.code);
    expect(q("[data-pairing-link] [role=img]")).toBeTruthy();
    expect(q("[data-guide-waiting]")?.textContent).toBe("Waiting for the link on that computer…");

    fx.open = [];
    await tick();
    expect(q("[data-add-computer-guide]")?.getAttribute("data-guide-status")).toBe("turnOn");
    expect(q("[data-guide-waiting]")?.textContent).toBe("Link pasted. Say yes on that computer.");
    expect(q("[data-pairing-link]")).toBeNull();

    fx.computers = [mac({ screenReady: false })];
    await tick();
    expect(q("[data-guide-connected]")?.textContent).toContain("Mac mini is connected. Allow its screen");
    expect(q("[data-allow-steps]")?.textContent).toContain("Accessibility");

    fx.computers = [mac({ screenReady: true })];
    await tick();
    expect(q("[data-guide-connected]")?.textContent).toContain("Mac mini is ready ✓");
    await click(button("Test connection"));
    expect(q("[data-connection-test=ok] img")?.getAttribute("src")).toBe("data:image/png;base64,c2NyZWVu");
    await click(button("Use Mac mini"));
    await click(button("Create bot"));
    expect(created()).toEqual({ type: "newBot", work: { computer: "cloud", cloudBackend: "lent", lentComputerId: mac().id } });
  } finally {
    vi.useRealTimers();
  }
});

it("Shared sign-ins is off by default and adds nothing", async () => {
  fx.browser = true;
  await open();
  expect(shared()?.getAttribute("aria-checked")).toBe("false");
  await click(button("Create bot"));
  expect(created()).toEqual({ type: "newBot", work: { computer: "browser" } });
  expect(fx.calls.some((call) => call.path === "/api/config")).toBe(false);
});

it("Shared sign-ins on, with no shared profile yet, makes one named Shared and puts the bot on it", async () => {
  fx.browser = true;
  await open();
  await click(shared());
  await click(button("Create bot"));
  const patch = fx.calls.find((call) => call.path === "/api/config" && call.method === "PATCH")?.body as { browserProfiles: Array<{ id: string; name: string }> };
  expect(patch.browserProfiles).toEqual([{ id: expect.stringMatching(/^profile-/), name: "Shared" }]);
  expect(created()).toEqual({ type: "newBot", work: { computer: "browser", browserProfile: patch.browserProfiles[0]!.id } });
});

it("Shared sign-ins on uses the shared profile there is", async () => {
  fx.browser = true;
  fx.profiles = [{ id: "profile-linkedin", name: "LinkedIn" }];
  await open();
  await click(shared());
  await click(button("Create bot"));
  expect(fx.calls.some((call) => call.path === "/api/config")).toBe(false);
  expect(created()).toEqual({ type: "newBot", work: { computer: "browser", browserProfile: "profile-linkedin" } });
});

it("shows no Shared sign-ins while the built-in browser is off", async () => {
  await open();
  expect(shared()).toBeNull();
});
