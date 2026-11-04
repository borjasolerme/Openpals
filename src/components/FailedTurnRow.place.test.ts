// The phones read only the row's English words, so those carry the same line and action.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { failedTurnCause, failedTurnTool } from "../../shared/failed-turn";
import { placeRowText, type PlaceRow } from "../../shared/place-view";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn(), advanced: false, ownerOrAdmin: null as boolean | null, bots: [] as Bot[], config: {} as Record<string, unknown> };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, config: fixture.config, instances: [] as InstanceInfo[], bots: fixture.bots },
    dispatch: fixture.dispatch, refreshInstances: vi.fn(), refreshModels: vi.fn(),
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "darwin" }, localComputer: { available: true } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/interface-mode", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => fixture.advanced,
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.ownerOrAdmin }));

const { FailedTurnRow } = await import("./ChatView");

const stored = (place: PlaceRow): NonNullable<Message["tool"]> => failedTurnTool(placeRowText(place), { place });

function show(tool: NonNullable<Message["tool"]>, onRetry?: () => void) {
  const html = renderToStaticMarkup(createElement(FailedTurnRow, { tool, engine: undefined, botId: "scout", threadId: "thread-scout", onRetry }));
  const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return { html, buttons };
}

beforeEach(() => {
  fixture.dispatch = vi.fn();
  fixture.advanced = false;
  fixture.ownerOrAdmin = null;
  fixture.config = {};
  fixture.bots = [{ id: "scout", name: "Scout", computer: "cloud", modelSelection: { instanceId: "claude", model: "m" } } as Bot];
});

describe("J11: a failed place's row", () => {

  it("offers Try again only where the conversation can retry", () => {
    const passing = stored({ state: "cc-unavailable", params: { bot: "Scout" }, source: "works-on" });
    expect(show(passing, vi.fn()).buttons).toHaveLength(1);
    expect(show(passing, vi.fn()).buttons[0]).toContain("Try again");
    expect(show(passing).buttons).toHaveLength(0);
  });

  it("leads a person's pin back to the grid's choice in Simple, and to the composer's in Advanced", () => {
    const pinned = stored({ state: "cc-no-start", params: { bot: "Scout" }, source: "pin" });
    expect(show(pinned).buttons[0]).toContain("Use Cloud desktop");
    fixture.advanced = true;
    expect(show(pinned).buttons[0]).toContain("Clear this conversation&#x27;s place");
  });

});

describe("the phone row", () => {
  // What iOS and Android (ChatPreferences failedTurnCause) do with a row: drop "error:" and show the rest; they never
  // read `place`.
  const phoneCause = (name: string) => name.startsWith("error:") ? name.slice("error:".length).trim() : null;

  it("carries the line and its action in words, whole, for every source", () => {
    const rows: Array<[PlaceRow, string]> = [
      [{ state: "cc-unavailable", params: { bot: "Scout" }, source: "auto-pin" },
        "Cloud desktops can't start right now. It isn't anything you did. This conversation is back on Auto. Send your message again."],
      [{ state: "cc-unavailable", params: { bot: "Scout" }, source: "routine" },
        "Cloud desktops can't start right now. It isn't anything you did. Change where this routine runs."],
    ];
    for (const [place, words] of rows) {
      const tool = stored(place);
      const onPhone = JSON.parse(JSON.stringify(tool)) as { name: string };
      expect(phoneCause(onPhone.name)).toBe(words);
      expect(failedTurnCause(onPhone.name)).toBe(words);
    }
  });
});
