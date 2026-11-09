// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), state: {} as AppState }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));

const { initialState } = await import("@/state/store");
const { announceArchiveNotice, archivableChief, archiveBotWithNotice, onArchiveNotice } = await import("./bot-archive");
const { botConfirmCopy } = await import("./ArchivedBotsPanel");

const make = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id[0]!.toUpperCase() + id.slice(1), title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "claude", model: "claude-opus-5-5" }, ...extra,
});
const scout = make("scout");
const nova = make("nova");

beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.state = { ...initialState, bots: [scout, nova], selectedId: "scout" };
});

describe("archiving a bot", () => {
  it("hides it, opens the next bot when it was on screen, and offers Undo", async () => {
    fixture.api.mockResolvedValue({ bot: { ...scout, hidden: true } });
    const notify = vi.fn();
    await archiveBotWithNotice(scout, { bots: [scout, nova], selectedId: "scout", dispatch: fixture.dispatch, notify });
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/scout", { method: "PATCH", body: JSON.stringify({ hidden: true }) });
    expect(fixture.dispatch.mock.calls).toEqual([
      [{ type: "botPatched", bot: { ...scout, hidden: true } }],
      [{ type: "select", id: "nova" }],
    ]);
    expect(notify.mock.calls).toEqual([
      [null],
      [{ error: false, text: "Scout archived", restoreBot: { id: "scout", name: "Scout" } }],
    ]);
  });

  it("stays on the open bot when another one is archived, and says why a failure failed", async () => {
    fixture.api.mockResolvedValueOnce({ bot: { ...nova, hidden: true } }).mockRejectedValueOnce(new Error("Server is offline"));
    const notify = vi.fn();
    await archiveBotWithNotice(nova, { bots: [scout, nova], selectedId: "scout", dispatch: fixture.dispatch, notify });
    expect(fixture.dispatch.mock.calls.map(([action]) => action.type)).toEqual(["botPatched"]);
    await archiveBotWithNotice(nova, { bots: [scout, nova], selectedId: "scout", dispatch: fixture.dispatch, notify });
    expect(notify).toHaveBeenLastCalledWith({ error: true, text: "Server is offline" });
  });

  it("archives a Chief of Staff, which stops being the Chief, instead of losing its chats to a delete", async () => {
    const chief = make("chief", { chiefOfStaff: true });
    const mausbot = make("mausbot", { chiefOfStaff: true, defaultBot: {} });
    expect(archivableChief([chief, scout], "chief")).toBe(chief);
    expect(archivableChief([chief], "chief"), "the last active bot stays").toBeUndefined();
    expect(archivableChief([mausbot, scout], "mausbot"), "the place's own MausBot is never deleted or archived").toBeUndefined();
    expect(archivableChief([chief, scout], "scout"), "only a Chief is offered this").toBeUndefined();
    expect(botConfirmCopy("delete", "Chief", true).body).toContain("Archive it instead to keep every conversation");
    expect(botConfirmCopy("delete", "Scout").body).not.toContain("Archive it instead");
    fixture.api.mockResolvedValue({ bot: { ...chief, hidden: true, chiefOfStaff: false } });
    await archiveBotWithNotice(chief, { bots: [chief, scout], selectedId: "scout", dispatch: fixture.dispatch, notify: vi.fn() });
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/chief", { method: "PATCH", body: JSON.stringify({ hidden: true, chiefOfStaff: false }) });
  });

  it("reaches the sidebar from anywhere, and says when no sidebar is there to hear", () => {
    const shown = vi.fn();
    expect(announceArchiveNotice(null)).toBe(false);
    const stop = onArchiveNotice(shown);
    expect(announceArchiveNotice({ error: false, text: "Scout archived" })).toBe(true);
    expect(shown).toHaveBeenCalledWith({ error: false, text: "Scout archived" });
    stop();
    expect(announceArchiveNotice(null)).toBe(false);
  });
});
