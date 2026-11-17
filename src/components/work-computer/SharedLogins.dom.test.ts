// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fx = vi.hoisted(() => ({
  dispatch: vi.fn(),
  flush: vi.fn(async () => {}),
  profiles: [] as Array<{ id: string; name: string }>,
  calls: [] as Array<{ path: string; method: string; body?: Record<string, unknown> }>,
}));
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  const api = async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    fx.calls.push({ path, method, body });
    if (path === "/api/config" && method === "PATCH") return { browserProfiles: body!.browserProfiles };
    if (path.startsWith("/api/bots/") && method === "PATCH") return { bot: { id: "bot-1", ...body } };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return {
    ...actual,
    api,
    useStore: () => ({
      state: { ...actual.initialState, config: { ...actual.initialState.config, features: { browser: true }, browserProfiles: fx.profiles } },
      dispatch: fx.dispatch,
      flushBotPatches: fx.flush,
    }),
  };
});

const { BotSharedLogins } = await import("./SharedLogins");

let host: HTMLDivElement;
let root: Root;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const toggle = () => document.querySelector<HTMLButtonElement>("[data-panel-row=shared-logins] [role=switch]");
const flip = async () => { await act(async () => { toggle()!.click(); }); await settle(); };
const botPatches = () => fx.calls.filter((call) => call.path === "/api/bots/bot-1" && call.method === "PATCH").map((call) => call.body);
const render = async (bot: Record<string, unknown>) => {
  await act(async () => root.render(createElement(BotSharedLogins, { bot: { id: "bot-1", name: "Chief", color: "blue", ...bot } as never })));
  await settle();
};

beforeEach(() => {
  setLocale("en");
  fx.dispatch.mockReset();
  fx.flush.mockClear();
  fx.profiles = [];
  fx.calls = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("is one Shared sign-ins switch; turning it on puts the bot on the shared profile there is", async () => {
  fx.profiles = [{ id: "profile-linkedin", name: "LinkedIn" }];
  await render({});
  expect(document.body.textContent).toContain("Shared sign-ins");
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  await flip();
  expect(fx.flush).toHaveBeenCalledWith("bot-1");
  expect(botPatches()).toEqual([{ browserProfile: "profile-linkedin" }]);
  expect(fx.calls.some((call) => call.path === "/api/config")).toBe(false);
});

it("with no shared profile yet, makes one named Shared and puts the bot on it", async () => {
  await render({});
  await flip();
  const config = fx.calls.find((call) => call.path === "/api/config")?.body as { browserProfiles: Array<{ id: string; name: string }> };
  expect(config.browserProfiles).toEqual([{ id: expect.stringMatching(/^profile-/), name: "Shared" }]);
  expect(botPatches()).toEqual([{ browserProfile: config.browserProfiles[0]!.id }]);
});

it("turning it off puts the bot back on its own browser", async () => {
  fx.profiles = [{ id: "profile-linkedin", name: "LinkedIn" }];
  await render({ browserProfile: "profile-linkedin" });
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
  await flip();
  expect(botPatches()).toEqual([{ browserProfile: null }]);
});

it("can't switch while the bot is working, and says to stop it first", async () => {
  await render({ busy: true });
  expect(toggle()?.disabled).toBe(true);
  expect(document.body.textContent).toContain("Stop this bot's turn before switching browser profiles.");
});
