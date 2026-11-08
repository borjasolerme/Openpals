// @vitest-environment happy-dom
// The first run, one screen at a time: where the bots live (desktop app only), the AI, then bots and apps to bring; what
// it saves, where it lands, and what a reload or a replay does.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import { GROK_MOVE_NOTICE } from "@/lib/notices";
import { EMPTY_ONBOARDING, MET_CHIEF_HINT, WELCOME_VERSION } from "@/lib/onboarding";
import { saveWelcomeDraft } from "@/lib/welcome-draft";
import type { InstanceInfo } from "@/state/store";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn(), onDone: vi.fn(), checks: [] as string[] }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: f.api }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/components/mascot-clock", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/components/EngineSetup", async (original) => {
  const { createElement: h } = await import("react");
  return { ...(await original<typeof import("@/components/EngineSetup")>()),
    EngineSetup: ({ instance }: { instance: InstanceInfo }) => h("div", { "data-engine-setup": instance.instanceId }) };
});
vi.mock("@/components/keys/KeyRow", async (original) => {
  const { createElement: h } = await import("react");
  return { ...(await original<typeof import("@/components/keys/KeyRow")>()), KeyRow: ({ id }: { id: string }) => h("div", { "data-key-row": id }) };
});
vi.mock("@/components/lazy-screens", async () => {
  const { createElement: h } = await import("react");
  return { GrokMoveDialog: ({ onClose }: { onClose: () => void }) => h("button", { "data-grok-move": "", onClick: onClose }, "Close Grok") };
});
const { WelcomeFlow } = await import("./WelcomeFlow");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const claude = (ready: boolean, aiTest?: InstanceInfo["aiTest"]): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", install: { docsUrl: "https://example.test" },
  snapshot: { state: ready ? "available" : "unavailable", authenticated: ready }, models: { default: "m", options: [] }, ...(aiTest ? { aiTest } : {}),
});
const freeOpenCode: InstanceInfo = {
  instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode", install: { docsUrl: "https://example.test" },
  snapshot: { state: "available", authenticated: true, freeFallback: true }, models: { default: "opencode/big-pickle", options: [] }, aiTest: "passed",
};
const signIn = (): InstanceInfo => ({ ...claude(false), snapshot: { state: "available", authenticated: false }, authentication: { method: "paste-code" } } as InstanceInfo);
const maus = { id: "maus", threadId: "t", name: "Pal", title: "", description: "", notifications: true, color: "chrome", unread: false,
  modelSelection: { instanceId: "claude", model: "m" }, messages: [], defaultBot: {}, chiefOfStaff: true };
const research = { ...maus, id: "research", threadId: "r", name: "Research", defaultBot: undefined, chiefOfStaff: false };

let host: HTMLDivElement, root: Root;
const text = () => host.textContent ?? "";
const title = () => host.querySelector("h1")?.textContent;
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label);
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no "${label}" button in: ${text()}`);
  await act(async () => { target.click(); });
};
const pick = async (selector: string) => { await act(async () => { host.querySelector<HTMLElement>(selector)!.click(); }); };
const type = async (selector: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async (selector: string) => { await act(async () => { host.querySelector<HTMLFormElement>(selector)!.requestSubmit(); }); };
const show = async (extra: Record<string, unknown> = {}) => {
  await act(async () => { root.render(createElement(WelcomeFlow, { onDone: f.onDone, ...extra })); });
  await act(async () => {});
};
const saved = () => f.api.mock.calls.filter(([path, init]) => path === "/api/config" && init?.method === "PUT").map(([, init]) => JSON.parse(init.body));
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, String(v)), removeItem: (k: string) => void values.delete(k), clear: () => values.clear() };
};
type Place = { kind: "local" } | { kind: "server"; url: string; label: string };
const desktop = (place: Place, ownPage = true) => {
  const bridge = {
    current: vi.fn(async () => place),
    connect: vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })),
    disconnect: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => {}),
  };
  Object.assign(window, { ogb: { place: bridge, app: { version: "1", ownPage } } });
  return bridge;
};

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  f.dispatch.mockReset();
  f.onDone.mockReset();
  f.api.mockReset();
  f.checks = [];
  f.api.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path.endsWith("/check")) { f.checks.push(path); return { ok: true }; }
    if (path === "/api/instances") return { instances: f.state.instances };
    if (path.endsWith("/test")) return { ok: true };
    return JSON.parse(init?.body ?? "{}");
  });
  f.state = { instances: [claude(true)], config: { onboarding: EMPTY_ONBOARDING, profile: { name: "" } }, bots: [maus] };
  stageIntro(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (window as { ogb?: unknown }).ogb;
  vi.unstubAllGlobals();
});

describe("a new install's first run", () => {
  it("signs in, starts with Pal, skips the apps and lands in Pal's chat", async () => {
    await show();
    expect(title(), "a browser has no question of where the bots live").toBe("Sign in to your AI");
    expect(button("Back"), "nothing before the first screen").toBeUndefined();
    expect(text()).toContain("Step 1 of 2");
    expect(f.checks, "the AI answered one tiny test message").toEqual(["/api/instances/claude/check"]);
    expect(host.querySelector("[data-ai-connected]")?.textContent).toBe("Connected to Claude");
    await press("Continue");

    expect(title()).toBe("Bring your bots and apps");
    expect(text()).toContain("Step 2 of 2");
    expect(button("Open Openpals"), "nothing brought yet").toBeDefined();
    expect(host.querySelector('[data-key-row="composio"]'), "a Composio project's key").not.toBeNull();
    expect(host.querySelector("[data-composio-personal]"), "or a personal one").not.toBeNull();
    await pick('[data-bots-choice="pal"]');
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true } });
    expect(host.querySelector("[data-bots-brought]")?.textContent).toBe("Ready: Pal");
    await press("Chat with Pal");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(introStaged("maus"), "its first messages arrive one at a time").toBe(true);
    await act(async () => {});
    expect(saved(), "the Grok Bot popup has nothing left to offer").toEqual([{ onboarding: expect.objectContaining({ version: WELCOME_VERSION, hintsSeen: [MET_CHIEF_HINT, GROK_MOVE_NOTICE] }) }]);
  });

  it("goes back a step with Back", async () => {
    await show({ initialBeat: "bring" });
    await press("Back");
    expect(title()).toBe("Sign in to your AI");
  });

  it("ends in the app with nothing brought, for the chat the app chooses", async () => {
    await show({ initialBeat: "bring" });
    await press("Open Openpals");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
    expect(introStaged("maus")).toBe(false);
  });

  it("comes back to the screen it was on after a reload", async () => {
    saveWelcomeDraft({ beat: "bring" });
    await show();
    expect(title()).toBe("Bring your bots and apps");
  });
});

describe("where the bots live", () => {
  it("is asked first in the desktop app on this computer, and This computer goes on to the AI", async () => {
    desktop({ kind: "local" });
    await show();
    expect(title()).toBe("Where should your bots live?");
    expect(text()).toContain("Welcome to Openpals, your own team of AI bots.");
    expect(text()).toContain("Step 1 of 3");
    expect(button("Back")).toBeUndefined();
    await pick('[data-place-choice="local"]');
    expect(title()).toBe("Sign in to your AI");
  });

  it("sets up a server from a Boat key with one button, showing where it is", async () => {
    const bridge = desktop({ kind: "local" });
    let report: (progress: { step: string; detail?: string }) => void = () => {};
    let finish: (result: unknown) => void = () => {};
    const setup = { start: vi.fn(() => new Promise((resolve) => { finish = resolve; })), onProgress: vi.fn((cb: typeof report) => { report = cb; return () => {}; }) };
    Object.assign(window.ogb!, { serverSetup: setup });
    await show({ initialBeat: "place" });
    await pick('[data-place-choice="server"]');
    expect(title()).toBe("Set up an always-on server");
    expect(host.querySelector('[data-server-setup="boat"]')?.textContent).toContain("Recommended");
    await type('[data-server-setup="boat"] input', " boat-key ");
    await submit('[data-server-setup="boat"]');
    expect(setup.start).toHaveBeenCalledWith({ kind: "boat", key: "boat-key" });
    expect(host.querySelector("[data-server-setup-progress]")?.textContent).toContain("Creating your server…");
    await act(async () => report({ step: "installing", detail: "Installing Node 24" }));
    expect(host.querySelector("[data-server-setup-progress]")?.textContent).toContain("Installing Openpals");
    expect(text()).toContain("Installing Node 24");
    await act(async () => finish({ ok: false, error: { code: "boat-key" } }));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("That key didn't work");
    expect(bridge.connect).not.toHaveBeenCalled();
  });

  it("sets up the person's own server over SSH and shows the installer's last lines when it fails", async () => {
    desktop({ kind: "local" });
    const setup = { start: vi.fn(async () => ({ ok: false, error: { code: "install-failed", output: "Error: Openpals did not start." } })), onProgress: vi.fn(() => () => {}) };
    Object.assign(window.ogb!, { serverSetup: setup });
    await show({ initialBeat: "place" });
    await pick('[data-place-choice="server"]');
    await type('[data-server-setup="ssh"] input', "root@203.0.113.7");
    await submit('[data-server-setup="ssh"]');
    expect(setup.start).toHaveBeenCalledWith({ kind: "ssh", address: "root@203.0.113.7" });
    expect(host.querySelector("[role=alert]")?.textContent).toContain("The setup stopped with an error");
    expect(host.querySelector("[role=alert] pre")?.textContent).toBe("Error: Openpals did not start.");
  });

  it("still pairs with a link pasted by hand", async () => {
    const place = desktop({ kind: "local" });
    await show({ initialBeat: "place" });
    await pick('[data-place-choice="server"]');
    await type("[data-pairing-link]", "https://bots.example.com/pair");
    await submit("[data-pairing-form]");
    expect(place.connect).not.toHaveBeenCalled();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("That isn't a pairing link");

    place.connect.mockResolvedValueOnce({ ok: false, error: "unreachable" });
    await type("[data-pairing-link]", "https://bots.example.com/pair#code=ABCD-EFGH-JKLM");
    await submit("[data-pairing-form]");
    expect(place.connect).toHaveBeenCalledWith("https://bots.example.com/pair#code=ABCD-EFGH-JKLM");
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Couldn't reach that server");

    place.connect.mockResolvedValueOnce({ ok: false, error: "cancelled" });
    await submit("[data-pairing-form]");
    expect(host.querySelector("[role=alert]"), "declining the app's own question is no error").toBeNull();
  });

  it("can still choose this computer instead", async () => {
    desktop({ kind: "local" });
    await show({ initialBeat: "place" });
    await pick('[data-place-choice="server"]');
    await press("Use this computer instead");
    expect(title()).toBe("Sign in to your AI");
  });

  it("is not asked again on the server's page once paired, which goes on from the AI", async () => {
    desktop({ kind: "server", url: "https://bots.example.com", label: "Box" }, false);
    await show();
    expect(title()).toBe("Sign in to your AI");
    expect(button("Back")).toBeUndefined();
  });
});

describe("with no AI working yet", () => {
  it("signs one in, or offers other ways and later", async () => {
    f.state = { ...f.state, instances: [signIn()] };
    await show({ initialBeat: "ai" });
    expect(button("Continue")).toBeUndefined();
    expect(button("Sign in with Claude")).toBeDefined();
    await press("Set up later");
    expect(title()).toBe("Bring your bots and apps");
  });

  it("opens every other way in the Connect an AI dialog, where OpenCode's free model is only a backup", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, claude(false)] };
    await show({ initialBeat: "ai" });
    expect(button("Connect Claude"), "an AI set up in Terminal opens the dialog").toBeDefined();
    expect(f.checks).toEqual([]);
    await press("Other ways to connect");
    const dialog = host.querySelector("[data-connect-ai]")!;
    expect(dialog.textContent).toContain("OpenCode's free model is ready as a backup");
    expect(dialog.querySelector('[data-engine-setup="claude"]')).not.toBeNull();
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector("[data-connect-ai]")).toBeNull();
    expect(title()).toBe("Sign in to your AI");
  });

  it("says why an AI didn't answer its test", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, claude(true, "failed")] };
    await show({ initialBeat: "ai" });
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Claude");
  });

  it("goes on once the AI connects, with the confirmation", async () => {
    f.state = { ...f.state, instances: [claude(false)] };
    await show({ initialBeat: "ai" });
    f.state = { ...f.state, instances: [claude(true)] };
    await show({ initialBeat: "ai" });
    await act(async () => {});
    expect(text()).toContain("Connected to Claude");
    expect(button("Set up later")).toBeUndefined();
  });
});

describe("bringing bots and apps", () => {
  it("opens the chat with the first bot moved from Grok Bot", async () => {
    await show({ initialBeat: "bring" });
    await pick('[data-bots-choice="grok"]');
    f.state = { ...f.state, bots: [maus, research] };
    await show({ initialBeat: "bring" });
    await press("Close Grok");
    expect(host.querySelector("[data-bots-brought]")?.textContent).toBe("Ready: Research");
    await press("Chat with Research");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("research");
  });

  it("saves a personal Composio key as an MCP server, switched on once Composio accepts it", async () => {
    await show({ initialBeat: "bring" });
    await type("[data-composio-personal] input", "ak_project");
    await submit("[data-composio-personal]");
    expect(host.querySelector("[data-composio-personal] [role=alert]")?.textContent).toBe("A personal Composio key starts with ck_.");
    await type("[data-composio-personal] input", "ck_mine");
    await submit("[data-composio-personal]");
    const calls = f.api.mock.calls.map(([path, init]) => `${init?.method ?? "GET"} ${path}`);
    expect(calls).toEqual(expect.arrayContaining(["POST /api/mcp/servers", "POST /api/mcp/servers/composio-personal/test", "PATCH /api/mcp/servers/composio-personal"]));
    expect(text()).toContain("Connected. Every bot can use your apps.");
  });
});

describe("other first runs", () => {
  it("gives a hosted place's admin the first screen only, then the chat", async () => {
    desktop({ kind: "local" });
    await show({ hosted: true });
    expect(text()).toContain("This is your team's shared Openpals");
    await press("Get started");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("a replay from Settings records nothing about a first chat", async () => {
    f.state = { ...f.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01T00:00:00.000Z", version: WELCOME_VERSION } } };
    await show({ replay: true, initialBeat: "bring" });
    await pick('[data-bots-choice="pal"]');
    await press("Chat with Pal");
    await act(async () => {});
    expect(saved()[0].onboarding).not.toHaveProperty("hintsSeen");
    expect(introStaged("maus"), "a replay lands in a chat that may be long under way").toBe(false);
  });
});
