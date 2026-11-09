// @vitest-environment happy-dom
// The first run as one window over the app: the steps across the top (where the bots live, in the desktop app only; the
// AI; bots and apps to bring), Continue, Back, Escape and the close button; what it saves, where it lands, and what a
// reload, a close or a replay does.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import { GROK_MOVE_NOTICE } from "@/lib/notices";
import { EMPTY_ONBOARDING, MET_CHIEF_HINT, WELCOME_VERSION } from "@/lib/onboarding";
import { saveWelcomeDraft } from "@/lib/welcome-draft";
import type { InstanceInfo } from "@/state/store";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn(), onDone: vi.fn(), onClose: vi.fn(), checks: [] as string[] }));
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
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn(async () => {}) }));
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
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"][data-welcome]')!;
const steps = () => [...host.querySelectorAll<HTMLButtonElement>("nav [data-welcome-step]")];
const radio = (kind: string) => host.querySelector<HTMLElement>(`[role="radio"][data-place-choice="${kind}"]`);
const key = async (target: Element, init: KeyboardEventInit) => { await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); }); };
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label);
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
  await act(async () => { root.render(createElement(WelcomeFlow, { onDone: f.onDone, onClose: f.onClose, ...extra })); });
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
    changed: (_place: Place) => {},
    onChanged: vi.fn((callback: (place: Place) => void) => { bridge.changed = callback; return () => {}; }),
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
  f.onClose.mockReset();
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
  // This computer's own server names it.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ label: "Ada's MacBook Pro.local" }), { status: 200 })));
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

describe("the first run's window", () => {
  it("is one dialog with the app's name, a close button and its steps across the top", async () => {
    await show();
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(dialog().textContent).toContain("Openpals");
    expect(button("Finish later"), "the X closes it").toBeDefined();
    expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe("Setup steps");
    expect(steps().map((step) => step.textContent), "a browser has no question of where the bots live").toEqual(["1AI", "2Bots & apps"]);
    expect(steps()[0]!.getAttribute("aria-current")).toBe("step");
    expect(title()).toBe("Sign in to your AI");
    expect(button("Back"), "nothing before the first step").toBeUndefined();
  });

  it("signs in, starts with Pal, skips the apps and lands in Pal's chat", async () => {
    await show();
    expect(f.checks, "the AI answered one tiny test message").toEqual(["/api/instances/claude/check"]);
    expect(host.querySelector('[data-ai-row="claude"]')?.textContent).toContain("Signed in");
    await press("Continue");

    expect(title()).toBe("Bring your bots and apps");
    expect(steps()[1]!.getAttribute("aria-current")).toBe("step");
    expect(host.querySelector('[data-key-row="composio"]'), "a Composio project's key").not.toBeNull();
    expect(host.querySelector("[data-composio-personal]"), "or a personal one").not.toBeNull();
    await pick('[data-bots-choice="pal"]');
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true } });
    expect(host.querySelector("[data-bots-brought]")?.textContent).toBe("Ready: Pal");
    expect(host.querySelector('[data-bots-choice="pal"]'), "started once").toBeNull();
    await press("Open Openpals");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(introStaged("maus"), "its first messages arrive one at a time").toBe(true);
    await act(async () => {});
    expect(saved(), "the Grok Bot popup has nothing left to offer").toEqual([{ onboarding: expect.objectContaining({ version: WELCOME_VERSION, hintsSeen: [MET_CHIEF_HINT, GROK_MOVE_NOTICE] }) }]);
  });

  it("goes back with Back, and to a step already reached from the steps, never ahead", async () => {
    desktop({ kind: "local" });
    await show();
    expect(steps().map((step) => step.disabled)).toEqual([false, true, true]);
    await press("Continue");
    expect(title()).toBe("Sign in to your AI");
    expect(steps().map((step) => step.disabled)).toEqual([false, false, true]);
    await act(async () => { steps()[0]!.click(); });
    expect(title()).toBe("Where your bots live");
    await act(async () => { steps()[1]!.click(); });
    expect(title()).toBe("Sign in to your AI");
    await press("Continue");
    await press("Back");
    expect(title()).toBe("Sign in to your AI");
  });

  it("Enter continues, except in a field; Escape and the X close it to finish later on the same step", async () => {
    await show();
    await key(dialog(), { key: "Enter" });
    expect(title()).toBe("Bring your bots and apps");
    await key(host.querySelector("[data-composio-personal] input")!, { key: "Enter" });
    expect(f.onDone, "Enter in a field is the field's").not.toHaveBeenCalled();
    await key(dialog(), { key: "Escape" });
    expect(f.onClose).toHaveBeenCalledOnce();
    await press("Finish later");
    expect(f.onClose).toHaveBeenCalledTimes(2);
    expect(f.onDone, "closing finishes nothing").not.toHaveBeenCalled();
    expect(saved()).toEqual([]);

    await act(async () => root.unmount());
    root = createRoot(host);
    await show();
    expect(title(), "opened again, it is where it was").toBe("Bring your bots and apps");
  });

  it("keeps Tab inside the window", async () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    await show({ initialBeat: "bring" });
    const focusable = [...dialog().querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
    focusable.at(-1)!.focus();
    await key(focusable.at(-1)!, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
    await key(focusable[0]!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable.at(-1));
  });

  it("ends in the app with nothing brought, for the chat the app chooses", async () => {
    await show({ initialBeat: "bring" });
    await press("Open Openpals");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
    expect(introStaged("maus")).toBe(false);
  });

  it("comes back to the step it was on after a reload", async () => {
    saveWelcomeDraft({ beat: "bring" });
    await show();
    expect(title()).toBe("Bring your bots and apps");
    expect(steps().map((step) => step.disabled), "the steps before it open again").toEqual([false, false]);
  });
});

describe("where the bots live", () => {
  it("comes first in the desktop app, with this computer chosen and connected, so Continue goes straight on", async () => {
    desktop({ kind: "local" });
    await show();
    expect(steps().map((step) => step.textContent)).toEqual(["1Connect", "2AI", "3Bots & apps"]);
    expect(title()).toBe("Where your bots live");
    expect(text()).toContain("Welcome to Openpals.");
    expect(radio("local")?.getAttribute("aria-checked")).toBe("true");
    expect(radio("local")?.textContent).toContain("Ada's MacBook Pro");
    expect(radio("local")?.textContent).toContain("Connected");
    expect(host.querySelector("[data-server-setup-flow]"), "Add a server starts closed").toBeNull();
    await press("Continue");
    expect(title()).toBe("Sign in to your AI");
  });

  it("names this computer as the person named it", async () => {
    desktop({ kind: "local" });
    f.state = { ...f.state, config: { ...(f.state.config as object), computerName: "Studio" } };
    await show();
    expect(radio("local")?.textContent).toContain("Studio");
  });

  it("adds a server from its pairing link, whose row becomes the place once connected", async () => {
    const place = desktop({ kind: "local" });
    await show();
    await pick("[data-add-server] > button");
    expect(host.querySelector("[data-add-server] > button")?.getAttribute("aria-expanded")).toBe("true");
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

    await submit("[data-pairing-form]");
    await act(async () => place.changed({ kind: "server", url: "https://bots.example.com", label: "Office box" }));
    expect(radio("server")?.textContent).toContain("Office box");
    expect(radio("server")?.textContent).toContain("https://bots.example.com");
    expect(radio("server")?.textContent).toContain("Connected");
    expect(radio("server")?.getAttribute("aria-checked")).toBe("true");
    expect(radio("local")?.getAttribute("aria-checked")).toBe("false");
    expect(radio("local")?.textContent).not.toContain("Connected");
  });

  it("sets up a server from a Boat key under Need a pairing link?, showing where it is even after a close", async () => {
    const bridge = desktop({ kind: "local" });
    let report: (progress: { step: string; detail?: string }) => void = () => {};
    let finish: (result: unknown) => void = () => {};
    const setup = { start: vi.fn(() => new Promise((resolve) => { finish = resolve; })), onProgress: vi.fn((cb: typeof report) => { report = cb; return () => {}; }) };
    Object.assign(window.ogb!, { serverSetup: setup });
    await show();
    await pick("[data-add-server] > button");
    expect(host.querySelector('[data-server-setup="boat"]'), "behind Need a pairing link?").toBeNull();
    await press("Need a pairing link?");
    expect(host.querySelector('[data-server-setup="boat"]')?.textContent).toContain("Recommended");
    expect(host.querySelector('[data-server-setup="ssh"]')).not.toBeNull();
    expect(host.querySelector("[data-install-command] code")?.textContent)
      .toBe("curl -fsSL https://raw.githubusercontent.com/borjasolerme/Openpals/main/scripts/install-server.sh | bash");
    await type('[data-server-setup="boat"] input', " boat-key ");
    await submit('[data-server-setup="boat"]');
    expect(setup.start).toHaveBeenCalledWith({ kind: "boat", key: "boat-key" });
    expect(host.querySelector("[data-server-setup-progress]")?.textContent).toContain("Creating your server…");
    await act(async () => report({ step: "installing", detail: "Installing Node 24" }));
    expect(host.querySelector("[data-server-setup-progress]")?.textContent).toContain("Installing Openpals");

    await act(async () => root.unmount());
    root = createRoot(host);
    await show();
    expect(host.querySelector("[data-server-setup-progress]")?.textContent, "reopened, the setup is still in view").toContain("Installing Node 24");

    await act(async () => finish({ ok: false, error: { code: "boat-key" } }));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("That key didn't work");
    expect(host.querySelector('[data-server-setup="boat"]'), "ready to try again").not.toBeNull();
    expect(bridge.connect).not.toHaveBeenCalled();
  });

  it("sets up the person's own server over SSH and shows the installer's last lines when it fails", async () => {
    desktop({ kind: "local" });
    const setup = { start: vi.fn(async () => ({ ok: false, error: { code: "install-failed", output: "Error: Openpals did not start." } })), onProgress: vi.fn(() => () => {}) };
    Object.assign(window.ogb!, { serverSetup: setup });
    await show();
    await pick("[data-add-server] > button");
    await press("Need a pairing link?");
    await type('[data-server-setup="ssh"] input', "root@203.0.113.7");
    await submit('[data-server-setup="ssh"]');
    expect(setup.start).toHaveBeenCalledWith({ kind: "ssh", address: "root@203.0.113.7" });
    expect(host.querySelector("[role=alert]")?.textContent).toContain("The setup stopped with an error");
    expect(host.querySelector("[role=alert] pre")?.textContent).toBe("Error: Openpals did not start.");
  });

  it("on the server's page, chooses the server, and choosing this computer instead goes back to it on Continue", async () => {
    const place = desktop({ kind: "server", url: "https://bots.example.com", label: "Office box" }, false);
    await show();
    expect(title()).toBe("Where your bots live");
    expect(fetch, "that server is not this computer").not.toHaveBeenCalled();
    expect(radio("server")?.getAttribute("aria-checked")).toBe("true");
    expect(radio("server")?.textContent).toContain("Connected");
    expect(radio("local")?.textContent).toContain("Your bots work while this computer is on and awake.");
    await pick("[data-add-server] > button");
    await press("Need a pairing link?");
    expect(host.querySelector("[data-server-setup]"), "only this computer's page sets one up").toBeNull();
    expect(host.querySelector("[data-install-command]")).not.toBeNull();

    await key(radio("server")!, { key: "ArrowUp" });
    expect(radio("local")?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio("local"));
    await press("Continue");
    expect(place.disconnect).toHaveBeenCalledOnce();
    expect(title(), "this computer's page takes over").toBe("Where your bots live");
  });

  it("goes on from the server it stays on", async () => {
    const place = desktop({ kind: "server", url: "https://bots.example.com", label: "Office box" }, false);
    await show();
    await press("Continue");
    expect(place.disconnect).not.toHaveBeenCalled();
    expect(title()).toBe("Sign in to your AI");
  });
});

describe("the AI", () => {
  it("signs in from the AI's own row, the code pasted under it", async () => {
    f.state = { ...f.state, instances: [signIn()] };
    f.api.mockImplementation(async (path: string) => {
      if (path === "/api/instances/claude/auth/start") return { auth: { phase: "waiting", flowId: "flow", authorizationUrl: "https://claude.ai/oauth/authorize?x=1" } };
      return {};
    });
    await show();
    const row = () => host.querySelector('[data-ai-row="claude"]')!;
    expect(row().textContent).toContain("Your Claude Pro or Max plan");
    await pick('[data-ai-row="claude"] [data-sign-in="sign-in"]');
    expect(f.api).toHaveBeenCalledWith("/api/instances/claude/auth/start", { method: "POST" });
    expect(row().querySelector('[data-sign-in="paste"] input')?.getAttribute("placeholder")).toBe("Paste the code from Claude");
    expect(button("Continue"), "the AI can wait").toBeDefined();
    await press("Continue");
    expect(title()).toBe("Bring your bots and apps");
  });

  it("opens every other way in the Connect an AI dialog, whose Escape closes only the dialog", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, claude(false)] };
    await show({ initialBeat: "ai" });
    expect(f.checks).toEqual([]);
    await pick('[data-ai-row="claude"] [data-sign-in="dialog"]');
    expect(host.querySelector("[data-connect-ai]")).not.toBeNull();
    await press("Close");
    await press("Other ways to connect");
    const connect = host.querySelector("[data-connect-ai]")!;
    expect(connect.textContent).toContain("OpenCode's free model is ready as a backup");
    expect(connect.querySelector('[data-engine-setup="claude"]')).not.toBeNull();
    await key(connect, { key: "Escape" });
    expect(host.querySelector("[data-connect-ai]")).toBeNull();
    expect(f.onClose).not.toHaveBeenCalled();
    expect(title()).toBe("Sign in to your AI");
  });

  it("says why an AI didn't answer its test", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, claude(true, "failed")] };
    await show({ initialBeat: "ai" });
    expect(host.querySelector('[data-ai-row="claude"]')?.textContent).toContain("No answer");
    expect(host.querySelector("[data-ai-silent]")?.textContent).toContain("Claude");
  });

  it("says Signed in once the AI connects", async () => {
    f.state = { ...f.state, instances: [claude(false)] };
    await show({ initialBeat: "ai" });
    f.state = { ...f.state, instances: [claude(true)] };
    await show({ initialBeat: "ai" });
    await act(async () => {});
    expect(host.querySelector('[data-ai-row="claude"]')?.textContent).toContain("Signed in");
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
    await press("Open Openpals");
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
  it("gives a hosted place's admin its welcome only, with no steps, then the chat", async () => {
    desktop({ kind: "local" });
    await show({ hosted: true });
    expect(host.querySelector("nav")).toBeNull();
    expect(text()).toContain("This is your team's shared Openpals");
    await press("Get started");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("a replay from Settings records nothing about a first chat", async () => {
    f.state = { ...f.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01T00:00:00.000Z", version: WELCOME_VERSION } } };
    await show({ replay: true, initialBeat: "bring" });
    await pick('[data-bots-choice="pal"]');
    await press("Open Openpals");
    await act(async () => {});
    expect(saved()[0].onboarding).not.toHaveProperty("hintsSeen");
    expect(introStaged("maus"), "a replay lands in a chat that may be long under way").toBe(false);
  });
});
