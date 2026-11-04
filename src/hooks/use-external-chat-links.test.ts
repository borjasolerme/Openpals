import type { EffectCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState, type Action, type AppState, type Bot, type Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ effects: [] as EffectCallback[], link: null as string | null }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: () => [fixture.link, (next: string | null) => { fixture.link = next; }],
  useEffect: (effect: EffectCallback) => { fixture.effects.push(effect); },
}));

import { openChatLink, useExternalChatLinks } from "./use-external-chat-links";

const scout: Bot = {
  id: "scout", threadId: "scout-main", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
  tasks: [{ threadId: "scout-main", title: "Main", createdAt: 1 }],
};
const loading: AppState = { ...initialState, bots: [], selectedId: "" };
const loaded: AppState = { ...initialState, bots: [scout], selectedId: "scout", hydrated: true };

/** One render: run its effects in order, as React would after commit. */
function render(state: AppState, dispatch: (action: Action) => void) {
  fixture.effects = [];
  useExternalChatLinks(state, dispatch);
  return fixture.effects.map((effect) => effect());
}

afterEach(() => { vi.unstubAllGlobals(); fixture.effects = []; fixture.link = null; });

describe("useExternalChatLinks", () => {
  it("holds a link that arrives at launch until the bots have loaded, then opens it once", () => {
    let deliver: ((link: string) => void) | undefined;
    const unsubscribe = vi.fn();
    vi.stubGlobal("window", { ogb: { onChatLink: (cb: (link: string) => void) => { deliver = cb; return unsubscribe; } } });
    const dispatch = vi.fn();

    const [cleanup] = render(loading, dispatch);
    expect(cleanup).toBe(unsubscribe);
    deliver!("openmausbot://bot/scout");
    render(loading, dispatch);
    expect(dispatch).not.toHaveBeenCalled();

    render(loaded, dispatch);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
    ]);
    expect(fixture.link).toBeNull();

    dispatch.mockClear();
    render(loaded, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("closes Settings and the shortcuts list so the linked chat is not left behind them", () => {
    vi.stubGlobal("window", {});
    fixture.link = "openmausbot://bot/scout";
    const dispatch = vi.fn();
    render({ ...loaded, appSettingsOpen: true, shortcutsOpen: true }, dispatch);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "toggleAppSettings", open: false },
      { type: "toggleShortcuts", open: false },
      { type: "select", id: "scout" },
    ]);
  });

  it("opens a bot's link as its row would: at its main thread", () => {
    vi.stubGlobal("window", {});
    fixture.link = "openmausbot://bot/scout";
    const dispatch = vi.fn();
    const left = { ...scout, threadId: "scout-report", mainThreadId: "scout-main",
      tasks: [...scout.tasks!, { threadId: "scout-report", title: "Report", createdAt: 2, unread: true }] };
    render({ ...loaded, bots: [left] }, dispatch);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "switchTask", botId: "scout", threadId: "scout-main" },
    ]);
  });

  it("does nothing without the desktop bridge", () => {
    vi.stubGlobal("window", {});
    const dispatch = vi.fn();
    expect(render(loaded, dispatch)).toEqual([undefined, undefined]);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("openChatLink", () => {
  const left = { ...scout, threadId: "scout-report", mainThreadId: "scout-main",
    tasks: [...scout.tasks!, { threadId: "scout-report", title: "Report", createdAt: 2 }] };
  const room: Group = {
    id: "standup", threadId: "standup-1", name: "Standup", memberIds: ["scout"], defaultResponder: { kind: "everyone" },
    bulletin: "", unread: false, createdAt: 1, messages: [], tasks: [{ threadId: "standup-1", title: "Monday", createdAt: 1 }, { threadId: "standup-2", title: "Tuesday", createdAt: 2 }],
  };
  const dm: Group = { ...room, id: "dm", threadId: "dm-1", dm: true, tasks: [{ threadId: "dm-1", title: "Private", createdAt: 5 }] };
  const state: AppState = { ...loaded, bots: [left], groups: [room, dm], selectedId: "other" };
  const opened = (link: string, at: AppState = state) => {
    const dispatch = vi.fn();
    const ok = openChatLink(dispatch, link, at);
    return { ok, actions: dispatch.mock.calls.map(([action]) => action) };
  };

  it("opens a bot's thread link at the bot's one chat, whichever of its threads it names", () => {
    for (const link of ["openmausbot://thread/scout-report?bot=scout", "openmausbot://thread/scout-report", "openmausbot://thread/gone?bot=scout"]) {
      expect(opened(link)).toEqual({ ok: true, actions: [{ type: "switchTask", botId: "scout", threadId: "scout-main" }] });
    }
  });

  it("opens a room's thread, or the room for its own link, never a bot-to-bot channel", () => {
    expect(opened("openmausbot://thread/standup-2?bot=standup")).toEqual({ ok: true, actions: [
      { type: "select", id: "standup" },
      { type: "switchGroupTask", groupId: "standup", threadId: "standup-2" },
      { type: "revealThread", threadId: "standup-2" },
    ] });
    expect(opened("openmausbot://bot/standup")).toEqual({ ok: true, actions: [{ type: "select", id: "standup" }] });
    expect(opened("openmausbot://bot/dm")).toEqual({ ok: false, actions: [{ type: "notice", notice: { kind: "bot-gone", botName: null } }] });
  });

  it("says so for a chat or link it does not know, from the team map back in the open chat", () => {
    for (const link of ["openmausbot://thread/missing?bot=nobody", "openmausbot://thread/x/extra", "openmausbot://bots/scout", "not a link"]) {
      expect(opened(link)).toEqual({ ok: false, actions: [{ type: "notice", notice: { kind: "thread-gone", botName: null } }] });
    }
    expect(opened("openmausbot://bot/nobody", { ...state, activeView: "web-panel" })).toEqual({ ok: false, actions: [
      { type: "select", id: "other" },
      { type: "notice", notice: { kind: "bot-gone", botName: null } },
    ] });
  });
});
