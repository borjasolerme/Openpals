import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTourFinished } from "@/lib/guided-tour";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING, LOCAL_VIEWER, markWelcomeFinished, MET_CHIEF_HINT, type WelcomeViewer } from "@/lib/onboarding";
import { launchDialogShown } from "@/lib/launch-dialogs";
import { registerDesktopPrefs } from "../../electron/desktop-prefs.mjs";

const f = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[], state: {} as any, dispatch: null as any, brand: "default",
  viewerEmail: undefined as string | null | undefined }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = typeof initial === "function" ? initial() : initial;
    return [f.values[index], (next: unknown) => { f.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(f.values[index]) : next; }]; },
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: vi.fn().mockResolvedValue({}) }));
// Who MausBot belongs to: unknown (as before the session answers) unless a test says otherwise.
vi.mock("@/lib/default-bot", async original => ({ ...await original<typeof import("@/lib/default-bot")>(), useViewerEmail: () => f.viewerEmail }));
vi.mock("@/lib/brand", () => ({ brandStatus: () => ({ brand: { name: "Openpals" }, source: f.brand, file: "" }), productName: () => "MausBot" }));
vi.mock("./Avatar", async original => ({ ...await original<typeof import("./Avatar")>(), MausAvatar: () => null }));
vi.mock("./lazy-screens", async original => ({ ...await original<typeof import("./lazy-screens")>(), GrokMoveDialog: () => "THE MOVE DIALOG" }));
vi.mock("@/components/EngineLibrary", () => ({ engineReady: (instance: { snapshot: { state: string; authenticated?: boolean } }) =>
  instance.snapshot.state === "available" && instance.snapshot.authenticated !== false }));
import { AppNotices } from "./AppNotices";
import { TwoPlacesCard } from "./TwoPlacesCard";
import { GROK_MOVE_NOTICE, launchNotice } from "@/lib/notices";
import { ADVANCED_MODE_KEY, setAdvancedMode } from "@/lib/interface-mode";
import { SIMPLE_MODE_PROMPT_KEY } from "@/lib/simple-mode-prompt";
import { api } from "@/state/store";

const NOW = new Date(2026, 9, 9, 12).getTime();

let storage: Map<string, string>;
let viewer: WelcomeViewer | null;
let now: number;

const PRELOAD = readFileSync(join(process.cwd(), "electron", "preload.cjs"), "utf8").replace(/\r\n/g, "\n");
const LOCAL_ORIGIN = "http://127.0.0.1:8799", OTHER = "https://other.example.test", VPS = "https://bots.example.test";
type Page = "local" | "server";
type Handler = (event: { page: Page; returnValue?: unknown }, ...args: unknown[]) => unknown;
interface Desktop {
  handlers: Map<string, Handler>; listeners: Map<string, Handler>; saved: { seen?: string[] } | null;
}
let desk: Desktop;

// Main's own record for this one desktop, behind its real IPC.
function desktopMachine(): Desktop {
  const machine: Desktop = { handlers: new Map(), listeners: new Map(), saved: null };
  registerDesktopPrefs({
    ipcMain: { handle: (channel, handler) => void machine.handlers.set(channel, handler as Handler), on: (channel, listener) => void machine.listeners.set(channel, listener as Handler) },
    read: () => machine.saved, write: value => { machine.saved = JSON.parse(JSON.stringify(value)); }, page: event => (event as { page: Page }).page,
  });
  return machine;
}

// The real preload, as this desktop's window loads it for a page.
function windowOn(origin: string, { click = true } = {}) {
  const page: Page = origin === LOCAL_ORIGIN ? "local" : "server";
  let ogb: Record<string, unknown> = {};
  vm.runInNewContext(PRELOAD, {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL_ORIGIN}`] },
    location: { origin }, navigator: { userActivation: { isActive: click } }, TextEncoder,
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name: string, value: Record<string, unknown>) => { ogb = value; } },
      ipcRenderer: { on() {}, removeListener() {}, send() {},
        sendSync: (channel: string) => { const event = { page, returnValue: undefined as unknown }; desk.listeners.get(channel)?.(event); return event.returnValue; },
        invoke: async (channel: string, ...args: unknown[]) => desk.handlers.get(channel)?.({ page }, ...args) } }),
  });
  return ogb;
}
const showWindow = (origin: string, options?: { click?: boolean }) => {
  vi.stubGlobal("window", { ogb: windowOn(origin, options), addEventListener: vi.fn(), removeEventListener: vi.fn() });
};

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const render = () => { f.index = 0; f.effects = []; return renderToStaticMarkup(createElement(AppNotices, { viewer, now: () => now })); };
async function settle(rounds = 4) { for (let i = 0; i < rounds; i++) { render(); f.effects.forEach(effect => effect()); await flush(); } return render(); }
const launch = () => { f.values = []; return settle(); };
/** The app opened again: a new window session, so nothing this launch showed holds the next one back. */
const relaunch = () => { session.clear(); return launch(); };
type Node = ReactElement<Record<string, any>>;
const nodes = (value: ReactNode): Node[] => {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  if (typeof node.type === "function") return nodes((node.type as (props: unknown) => ReactNode)(node.props));
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
};
const tree = () => { f.index = 0; f.effects = []; return nodes(AppNotices({ viewer, now: () => now })); };
const press = (label: string) => {
  const button = tree().find(node => node.type === "button" && (renderToStaticMarkup(node).includes(`>${label}<`) || node.props["aria-label"] === label));
  expect(button, label).toBeTruthy(); button!.props.onClick();
};
/** A bot has answered once, in this launch: what a new install has after its first chat. */
const FIRST_REPLY = [{ tasks: [{ threadId: "first", usage: { turns: 1 } }] }];
let session: Map<string, string>;
const returning = () => { f.state.bots = [{ tasks: [{ threadId: "t", createdAt: 1, usage: { turns: 2 } }] }]; };
const launchCardsSeen = () => { storage.set(GROK_MOVE_NOTICE, "1"); storage.set(SIMPLE_MODE_PROMPT_KEY, "1"); };
const hints = () => f.state.config.onboarding.hintsSeen as string[];

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  storage = new Map(); f.values = []; f.index = 0; f.effects = []; f.brand = "default"; f.dispatch = vi.fn(); now = NOW; desk = desktopMachine();
  setLocale("en"); viewer = LOCAL_VIEWER;
  session = new Map(); f.viewerEmail = undefined;
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => session.set(key, value) });
  f.state = { connected: true, hydrated: true, bots: structuredClone(FIRST_REPLY), groups: [], routines: [], instances: [{ instanceId: "claude", snapshot: { state: "available", authenticated: true } }],
    config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01", version: 1, hintsSeen: withTourFinished(undefined) } } };
  vi.mocked(api).mockImplementation(async (_path, init) => {
    const patch = JSON.parse(String((init as RequestInit).body));
    f.state.config.onboarding.hintsSeen = patch.onboarding.hintsSeen;
    return f.state.config;
  });
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  // The popups start seen: each describe opens its own.
  launchCardsSeen();
  showWindow(LOCAL_ORIGIN);
  vi.stubGlobal("document", { activeElement: null, body: null, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); setLocale("en"); });

describe("the Move from Grok Bot popup", () => {
  const TITLE = "Move from Grok Bot", DIALOG = "THE MOVE DIALOG";
  let modal: boolean;
  const reads = () => vi.mocked(api).mock.calls.map(([path]) => path).filter(path => path === "/api/setup-import/grok");
  const keydown = (key: string) => {
    const handler = vi.mocked(window.addEventListener).mock.calls.filter(([type]) => type === "keydown").at(-1)![1] as (event: unknown) => void;
    handler({ key, preventDefault() {}, stopPropagation() {} });
  };
  const endedForGood = async () => {
    expect(render()).toBe("");
    expect(storage.get(GROK_MOVE_NOTICE)).toBe("1"); expect(hints()).toContain(GROK_MOVE_NOTICE); expect(desk.saved?.seen).toContain(GROK_MOVE_NOTICE);
    expect(await launch(), "a reload is the same launch").not.toContain(TITLE);
    expect(await relaunch(), "nor any later one").not.toContain(TITLE);
  };

  beforeEach(() => {
    modal = false;
    storage.delete(GROK_MOVE_NOTICE);
    vi.stubGlobal("document", { activeElement: null, body: null, documentElement: { dataset: {} }, getElementById: () => null,
      querySelector: (selector: string) => selector === "[data-grok-move-popup]" ? { querySelectorAll: () => [] } : null,
      querySelectorAll: () => modal ? [{ closest: () => null, checkVisibility: () => true }] : [] });
  });

  it("someone already here sees it at their next launch, a modal with the two marks, and it reads nothing on this computer", async () => {
    returning();
    const html = await launch();
    for (const text of [TITLE, "Bring your Bots here, with their skills, routines and memories.", "Let&#x27;s start", "Not now"]) expect(html).toContain(text);
    for (const part of ['role="dialog"', 'aria-modal="true"', "data-grok-move-popup"]) expect(html).toContain(part);
    expect(launchNotice()).toBe(GROK_MOVE_NOTICE);
    expect(launchDialogShown(), "MausBot's card waits for a later launch").toBe("notices");
    expect(await settle()).toContain(TITLE);
    expect(reads(), "showing it looks at neither Downloads nor the Grok Bot app").toEqual([]);
  });

  it("goes first in the queue, one a launch: the Simple mode popup waits for a later launch", async () => {
    returning(); storage.delete(SIMPLE_MODE_PROMPT_KEY);
    const first = await launch();
    expect(first).toContain(TITLE);
    expect(first).not.toContain("data-simple-mode-prompt");
    press("Not now"); await flush();
    expect(render(), "nothing else after it in this launch").toBe("");
    expect(await launch(), "a reload is the same launch").toBe("");
    const second = await relaunch();
    expect(second).toContain("data-simple-mode-prompt"); expect(second).not.toContain(TITLE);
    expect(launchNotice()).not.toBe(GROK_MOVE_NOTICE);
  });

  it("never during onboarding; after a new install's welcome it follows the first messages, while the other cards keep to the first chat's quiet", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    f.state.bots = [{ tasks: [{ threadId: "first" }] }];
    f.state.config.onboarding = { ...EMPTY_ONBOARDING };
    expect(await launch(), "the welcome is due").toBe("");
    f.state.welcomeOpen = true;
    f.state.config.onboarding = { ...EMPTY_ONBOARDING, completedAt: "2026-11-01", version: 1, hintsSeen: [MET_CHIEF_HINT] };
    expect(await launch(), "the welcome is open").toBe("");
    f.state.welcomeOpen = false; markWelcomeFinished();
    expect(await settle(), "its first messages are still arriving").toBe("");
    vi.advanceTimersByTime(6_000);
    const html = await settle();
    expect(html).toContain(TITLE);
    press("Let&#x27;s start"); await flush();
    expect(render()).toContain(DIALOG);
    expect(storage.get(GROK_MOVE_NOTICE)).toBe("1");
  });

  it("Not now, the X and Escape end it for good, on this computer and in the workspace", async () => {
    for (const how of ["Not now", "Close", "Escape"] as const) {
      session.clear(); storage.delete(GROK_MOVE_NOTICE); desk = desktopMachine(); f.state.config.onboarding.hintsSeen = withTourFinished(undefined);
      returning();
      expect(await launch(), how).toContain(TITLE);
      if (how === "Escape") keydown("Escape"); else press(how);
      await flush();
      await endedForGood();
    }
  });

  it("Let's start opens the same dialog, ends the popup for good, and only the dialog looks on this computer", async () => {
    returning();
    await launch();
    press("Let&#x27;s start"); await flush();
    expect(render()).toContain(DIALOG);
    expect(storage.get(GROK_MOVE_NOTICE)).toBe("1"); expect(hints()).toContain(GROK_MOVE_NOTICE); expect(desk.saved?.seen).toContain(GROK_MOVE_NOTICE);
    expect(reads()).toEqual([]);
    expect(await relaunch()).not.toContain(TITLE);
  });

  it("never during a bot's turn, a dialog, a call or while a move is starting up; it comes when they end", async () => {
    returning();
    f.state.bots = [{ busy: true, tasks: [{ threadId: "t", createdAt: 1, usage: { turns: 2 } }] }];
    expect(await launch(), "a turn").toBe("");
    returning();
    modal = true;
    expect(await launch(), "another dialog").toBe("");
    modal = false;
    f.state.liveCall = { status: "connected" };
    expect(await launch(), "a call").toBe("");
    f.state.liveCall = null;
    expect(await launch()).toContain(TITLE);
  });

  it("seen on this desktop from another page, it doesn't come back", async () => {
    returning(); desk.saved = { seen: [GROK_MOVE_NOTICE] };
    expect(await launch()).not.toContain(TITLE);
  });

  it("a page newer than its desktop: main ignores the new id, and the workspace and this browser still end it for good", async () => {
    returning();
    desk.handlers.set("desktop-notices:seen", async () => undefined);
    desk.handlers.set("desktop-notices:state", async () => ({ seen: [] }));
    expect(await launch()).toContain(TITLE);
    press("Not now"); await flush();
    expect(storage.get(GROK_MOVE_NOTICE)).toBe("1"); expect(hints()).toContain(GROK_MOVE_NOTICE);
    expect(await relaunch()).not.toContain(TITLE);
    storage.delete(GROK_MOVE_NOTICE);
    expect(await relaunch(), "in another browser, the workspace remembers").not.toContain(TITLE);
  });

  it("stays away from those who can't add a bot and from what isn't ours to promote: a member, a branded build", async () => {
    returning();
    viewer = { hosted: true, canSave: false };
    expect(await launch(), "a member").not.toContain(TITLE);
    viewer = LOCAL_VIEWER;
    f.brand = "file";
    expect(await relaunch(), "a branded build").not.toContain(TITLE);
  });
});

describe("the Simple mode popup after the update", () => {
  const TITLE = "Try the new Simple mode", ON = "You&#x27;re on Simple mode";
  let modal: boolean;

  beforeEach(() => {
    modal = false;
    vi.stubGlobal("document", { activeElement: null, body: null, documentElement: { dataset: {} }, getElementById: () => null, querySelector: () => null,
      querySelectorAll: () => modal ? [{ closest: () => null, checkVisibility: () => true }] : [] });
    setAdvancedMode(true);
    storage.delete(SIMPLE_MODE_PROMPT_KEY);
  });

  it("shows once in each browser, claims the launch, and never comes back once it is closed", async () => {
    const html = await launch();
    expect(html).toContain(TITLE);
    for (const part of ['role="dialog"', 'aria-modal="true"', 'role="switch"', 'aria-checked="false"', "Switch any time in Settings → General."]) expect(html).toContain(part);
    expect(launchDialogShown()).toBe("notices");
    expect(await settle()).toContain(TITLE);
    press("Done"); await flush();
    expect(render(), "nothing else in this launch after it").toBe("");
    expect(storage.get(SIMPLE_MODE_PROMPT_KEY)).toBe("1");
    session.clear();
    expect(await launch()).not.toContain(TITLE);
  });

  it("changes the mode live from the popup, both ways, while its words stay", async () => {
    await launch();
    press("Simple mode"); await flush();
    expect(storage.get(ADVANCED_MODE_KEY)).toBe("0");
    const on = render();
    expect(on).toContain('aria-checked="true"'); expect(on).toContain(TITLE);
    press("Simple mode"); await flush();
    expect(storage.get(ADVANCED_MODE_KEY)).toBe("1");
    expect(render()).toContain('aria-checked="false"');
    expect(storage.has(SIMPLE_MODE_PROMPT_KEY), "flipping never closes it").toBe(false);
  });

  it("tells someone already on Simple mode so, with the switch on", async () => {
    setAdvancedMode(false);
    const html = await launch();
    expect(html).toContain(ON); expect(html).toContain('aria-checked="true"');
  });

  it("asks on a server's own page and in a plain browser too, not only on this computer's", async () => {
    showWindow(VPS);
    expect(await launch()).toContain(TITLE);
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    viewer = { hosted: true, canSave: true };
    expect(await launch()).toContain(TITLE);
  });

  it("waits during the welcome, the tour, Settings, the quiet first chat, another dialog or a call, and skips the launch its welcome finished in", async () => {
    const waits: Array<() => void> = [
      () => { f.state.welcomeOpen = true; }, () => { f.state.tourOpen = true; }, () => { f.state.appSettingsOpen = true; }, () => { modal = true; },
      () => { f.state.liveCall = { status: "live" }; }, () => { f.state.config.onboarding.completedAt = undefined; },
      () => { f.state.config.onboarding.hintsSeen = [...withTourFinished(undefined), MET_CHIEF_HINT]; f.state.bots = [{ tasks: [{ threadId: "first", usage: { turns: 0 } }] }]; },
    ];
    for (const wait of waits) {
      const saved = structuredClone(f.state); wait();
      expect(await launch(), wait.toString()).not.toContain(TITLE);
      f.state = saved; modal = false;
    }
    markWelcomeFinished();
    expect(await launch(), "the launch the welcome finished in").not.toContain(TITLE);
    session.clear();
    expect(await launch()).toContain(TITLE);
    expect(storage.has(SIMPLE_MODE_PROMPT_KEY)).toBe(false);
  });
});

describe("bots in two places", () => {
  const GARAGE = { key: "server:https://garage.example.test", name: "Garage server", kind: "server" as const };
  const BODY = "Your bots live in two places, so they can&#x27;t work together. Bring them together on Garage server?";
  let suggest: { key: string; name: string; kind: "server" } | null;
  let accepted: string[], dismissed: string[];
  beforeEach(() => {
    suggest = GARAGE; accepted = []; dismissed = [];
    desk.handlers.set("two-places:state", async () => ({ suggest }));
    desk.handlers.set("two-places:accept", async (_event, key) => { accepted.push(String(key)); suggest = null; return { suggest }; });
    desk.handlers.set("two-places:dismiss", async (_event, key) => { dismissed.push(String(key)); suggest = null; return { suggest }; });
  });

  it("one plain card on this computer's page, before any promotion; bots move there only after the person confirms (#4192)", async () => {
    returning();
    const html = await launch();
    expect(html).toContain('data-notice="two-places"');
    expect(html).toContain("Bring your bots together");
    expect(html).toContain(BODY);
    press("Bring them together");
    const asking = await settle();
    expect(accepted, "one tap never moves anyone").toEqual([]);
    expect(asking).toContain("Move this computer&#x27;s bots to Garage server?");
    expect(asking, "the undo switch is My Cloud's only").not.toContain("Keep this computer&#x27;s bots on this computer");
    press("Move bots");
    await flush();
    expect(accepted).toEqual([GARAGE.key]);
    expect(await settle()).not.toContain('data-notice="two-places"');
  });

  it("Cancel on the confirm step moves nothing and keeps the card (#4192)", async () => {
    returning();
    await launch();
    press("Bring them together");
    await settle();
    press("Cancel");
    const after = await settle();
    expect(accepted).toEqual([]);
    expect(dismissed).toEqual([]);
    expect(after).toContain('data-notice="two-places"');
    expect(after).not.toContain("Move bots");
    expect(after).toContain("Bring them together");
    expect(tree().find(node => node.props["data-two-places-bring"])?.props.autoFocus, "focus returns to the button Cancel brought back").toBe(true);
  });

  it("Escape on the confirm step works as Cancel and never dismisses the card", async () => {
    returning();
    await launch();
    press("Bring them together");
    await settle();
    const escape = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    tree().find(node => node.props.role === "group")!.props.onKeyDown(escape);
    expect(escape.stopPropagation, "the card's own Escape never sees it").toHaveBeenCalled();
    const after = await settle();
    expect(dismissed).toEqual([]);
    expect(accepted).toEqual([]);
    expect(after).toContain('data-notice="two-places"');
    expect(after).not.toContain("Move bots");
  });

  it("a different suggested place starts a fresh card, so a confirm never carries over to it", async () => {
    returning();
    await launch();
    // Children.toArray would re-key, so walk the elements as rendered.
    const find = (value: unknown): Node | undefined => {
      if (Array.isArray(value)) return value.map(find).find(Boolean);
      if (!isValidElement(value)) return undefined;
      const node = value as Node;
      if (node.type === TwoPlacesCard) return node;
      return typeof node.type === "function" ? find((node.type as (props: unknown) => ReactNode)(node.props)) : find(node.props.children);
    };
    f.index = 0; f.effects = [];
    expect(find(AppNotices({ viewer, now: () => now }))?.key).toBe(GARAGE.key);
  });

  it("Not now hands main the place to remember, and the card goes", async () => {
    returning();
    expect(await launch()).toContain(BODY);
    press("Not now");
    await flush();
    expect(dismissed).toEqual([GARAGE.key]);
    expect(await settle()).not.toContain('data-notice="two-places"');
    expect(await launch(), "main remembers it: never asked again").not.toContain('data-notice="two-places"');
  });

  it("never during the welcome or the tour, on a server's page, or when main suggests nothing", async () => {
    returning();
    f.state.welcomeOpen = true;
    expect(await launch()).not.toContain('data-notice="two-places"');
    f.state.welcomeOpen = false; f.state.tourOpen = true;
    expect(await launch()).not.toContain('data-notice="two-places"');
    f.state.tourOpen = false;
    for (const origin of [OTHER, VPS]) {
      showWindow(origin);
      expect(await launch(), origin).not.toContain('data-notice="two-places"');
    }
    showWindow(LOCAL_ORIGIN);
    suggest = null;
    expect(await launch()).not.toContain('data-notice="two-places"');
  });

  it("is this computer's page's alone: no other page gets the bridge, and none would show it", async () => {
    returning();
    expect(windowOn(LOCAL_ORIGIN).twoPlaces).toBeDefined();
    for (const origin of [OTHER, VPS]) expect(windowOn(origin).twoPlaces, origin).toBeUndefined();
    const ask = vi.fn(async () => ({ suggest: GARAGE }));
    vi.stubGlobal("window", { ogb: { ...windowOn(OTHER), twoPlaces: { state: ask, accept: ask, dismiss: ask, onChanged: () => () => {} } }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    expect(await launch(), "a server's page handed the bridge anyway").not.toContain('data-notice="two-places"');
  });
});
