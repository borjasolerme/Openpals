import { describe, expect, it } from "vitest";

import {
  BOT_CHATS_SECTION_ID,
  BOTS_SECTION_ID,
  CHANNELS_SECTION_ID,
  PINNED_SECTION_ID,
  mergeSectionOrder,
  moveSection,
  orderedSidebarSections,
  partitionSidebarBots,
  partitionSidebarGroups,
  placeSection,
  sidebarConnectorPreview,
  sidebarLayoutInteractive,
  sidebarGoalRunPreview,
  sidebarSectionCollapsed,
  sidebarSectionLabel,
  simpleOrderedSections,
  simpleSidebarSections,
  withPrimaryTile,
} from "./sidebar-layout";

describe("the sidebar's lists", () => {
  it("labels the built-in sections", () => {
    expect(sidebarSectionLabel(CHANNELS_SECTION_ID)).toBe("Group chats");
    expect(sidebarSectionLabel(BOT_CHATS_SECTION_ID)).toBe("Bot threads");
  });

  it("is one flat list of bots: a section stored on an older bot changes nothing", () => {
    const writer = { id: "writer", section: "Work", pinned: true };
    const parts = partitionSidebarBots([
      { id: "chief", chiefOfStaff: true },
      writer,
      { id: "plain" },
      { id: "filed", section: "Work" },
      { id: "hidden", hidden: true, pinned: true },
    ]);
    expect(parts.chief?.id).toBe("chief");
    expect(parts.pinnedBots).toEqual([writer]);
    expect(parts.bots.map((candidate) => candidate.id)).toEqual(["plain", "filed"]);
  });

  it("lists the bots in the order they arrive, never by name", () => {
    // The server owns this order (PUT /api/bots/order); a reorder made on a phone must show up here unchanged.
    const parts = partitionSidebarBots([
      { id: "zed", name: "Zed", pinned: true },
      { id: "yak", name: "Yak" },
      { id: "xon", name: "Xon" },
      { id: "amy", name: "Amy", pinned: true },
      { id: "cat", name: "Cat" },
    ]);
    expect(parts.pinnedBots.map((bot) => bot.id)).toEqual(["zed", "amy"]);
    expect(parts.bots.map((bot) => bot.id)).toEqual(["yak", "xon", "cat"]);
  });

  it("splits group chats from bot threads, whatever section an older group chat stored", () => {
    const dm = { id: "dm", dm: true };
    const parts = partitionSidebarGroups([dm, { id: "project", section: "Work" }, { id: "general" }]);
    expect(parts.botChats).toEqual([dm]);
    expect(parts.rooms.map((room) => room.id)).toEqual(["project", "general"]);
  });

  it("keeps the Chief's own top slot; another Chief is listed with the bots", () => {
    const bots = [
      { id: "main-chief", chiefOfStaff: true },
      { id: "other-chief", chiefOfStaff: true },
      { id: "member" },
    ];
    const parts = partitionSidebarBots(bots);
    expect(parts.chief?.id).toBe("main-chief");
    expect(parts.bots.map((bot) => bot.id)).toEqual(["other-chief", "member"]);
  });

  it("lifts pinned bots, the Chief too, when pins are universal; otherwise a pinned Chief keeps its top slot", () => {
    const bots = [
      { id: "chief", chiefOfStaff: true, pinned: true },
      { id: "plain-pinned", pinned: true },
      { id: "stay" },
    ];
    const local = partitionSidebarBots(bots);
    expect(local.pinnedBots.map((bot) => bot.id)).toEqual(["plain-pinned"]);
    expect(local.chief?.id).toBe("chief");
    const universal = partitionSidebarBots(bots, { universalPins: true });
    expect(universal.pinnedBots.map((bot) => bot.id)).toEqual(["chief", "plain-pinned"]);
    expect(universal.chief).toBeNull();
    expect(universal.bots.map((bot) => bot.id)).toEqual(["stay"]);
  });

  it("forces filtered and icon-only views open and non-reorderable", () => {
    expect(sidebarLayoutInteractive("comfortable", "")).toBe(true);
    expect(sidebarLayoutInteractive("comfortable", "writer")).toBe(false);
    expect(sidebarLayoutInteractive("icons", "")).toBe(false);
    expect(sidebarSectionCollapsed(PINNED_SECTION_ID, [PINNED_SECTION_ID], "comfortable", "")).toBe(true);
    expect(sidebarSectionCollapsed(PINNED_SECTION_ID, [PINNED_SECTION_ID], "comfortable", "writer")).toBe(false);
    expect(sidebarSectionCollapsed(PINNED_SECTION_ID, [PINNED_SECTION_ID], "icons", "")).toBe(false);
  });

  it("keeps a terminal channel goal meaningful in the sidebar", () => {
    expect(sidebarGoalRunPreview({
      runId: "run-1",
      goal: "Ship the launch post",
      status: "completed",
      coordinatorBotId: "lead",
      coordinatorName: "Lead",
      turnCount: 3,
      maxTurns: 13,
      detail: "Drafted and verified.",
      startedAt: 1,
      finishedAt: 2,
    })).toBe("Completed: Drafted and verified.");
  });

  it("previews a connection card by its app and state, not the phone fallback line", () => {
    const say = (key: string) => ({
      "connectors.card.connected": "Connected",
      "connectors.card.waiting": "Waiting for sign-in…",
      "connectors.card.connectSecurely": "Connect securely",
    })[key] ?? key;
    const card = { label: "GitHub", status: "required" as const };
    expect(sidebarConnectorPreview(card, say)).toBe("GitHub · Connect securely");
    expect(sidebarConnectorPreview({ ...card, status: "failed" }, say)).toBe("GitHub · Connect securely");
    expect(sidebarConnectorPreview({ ...card, status: "authorizing" }, say)).toBe("GitHub · Waiting for sign-in…");
    expect(sidebarConnectorPreview({ ...card, status: "connected" }, say)).toBe("GitHub · Connected");
    expect(sidebarConnectorPreview({ ...card, dismissed: true }, say)).toBe("GitHub");
  });
});

const work = "builtin:work";
const home = "builtin:home";

describe("sidebar section ordering", () => {
  const natural = [
    PINNED_SECTION_ID,
    CHANNELS_SECTION_ID,
    BOT_CHATS_SECTION_ID,
    BOTS_SECTION_ID,
    work,
  ];

  it("uses natural order when no preference exists", () => {
    expect(orderedSidebarSections(natural, [])).toEqual(natural);
  });

  it("preserves a user move and inserts a newly visible bucket naturally", () => {
    const withoutBotChats = natural.filter((id) => id !== BOT_CHATS_SECTION_ID);
    const saved = [work, PINNED_SECTION_ID, CHANNELS_SECTION_ID, BOTS_SECTION_ID];
    expect(orderedSidebarSections(withoutBotChats, saved)).toEqual(saved);
    expect(orderedSidebarSections(natural, saved)).toEqual([
      work,
      PINNED_SECTION_ID,
      CHANNELS_SECTION_ID,
      BOT_CHATS_SECTION_ID,
      BOTS_SECTION_ID,
    ]);
  });

  it("moves and drops sections without wrapping", () => {
    expect(moveSection(natural, CHANNELS_SECTION_ID, -1)).toEqual([
      CHANNELS_SECTION_ID,
      PINNED_SECTION_ID,
      BOT_CHATS_SECTION_ID,
      BOTS_SECTION_ID,
      work,
    ]);
    expect(moveSection(natural, PINNED_SECTION_ID, -1)).toBe(natural);
    expect(placeSection(natural, BOTS_SECTION_ID, PINNED_SECTION_ID, "before")).toEqual([
      BOTS_SECTION_ID,
      PINNED_SECTION_ID,
      CHANNELS_SECTION_ID,
      BOT_CHATS_SECTION_ID,
      work,
    ]);
  });

  it("retains empty sections in their saved slot", () => {
    const visible = natural.filter((id) => id !== CHANNELS_SECTION_ID);
    expect(mergeSectionOrder(natural, visible)).toEqual(natural);
  });

  it("retains leading empty sections before their next visible successor", () => {
    const personal = home;
    const saved = [work, personal, PINNED_SECTION_ID, CHANNELS_SECTION_ID];

    expect(mergeSectionOrder(saved, [PINNED_SECTION_ID, CHANNELS_SECTION_ID])).toEqual(saved);
  });

  it("preserves a leading empty section when visible sections were reordered", () => {
    const saved = [work, PINNED_SECTION_ID, CHANNELS_SECTION_ID];

    expect(mergeSectionOrder(saved, [CHANNELS_SECTION_ID, PINNED_SECTION_ID])).toEqual([
      CHANNELS_SECTION_ID,
      work,
      PINNED_SECTION_ID,
    ]);
  });
});

describe("Simple-mode section order", () => {
  it("puts Pinned, the bots, group chats and bot threads first, then the rest in their saved order", () => {
    const natural = [PINNED_SECTION_ID, CHANNELS_SECTION_ID, BOT_CHATS_SECTION_ID, BOTS_SECTION_ID, work];
    expect(simpleSidebarSections(natural)).toEqual([PINNED_SECTION_ID, BOTS_SECTION_ID, CHANNELS_SECTION_ID, BOT_CHATS_SECTION_ID, work]);
    expect(simpleSidebarSections([work, CHANNELS_SECTION_ID, BOTS_SECTION_ID])).toEqual([BOTS_SECTION_ID, CHANNELS_SECTION_ID, work]);
    const saved = orderedSidebarSections([CHANNELS_SECTION_ID, BOTS_SECTION_ID, work, home], [home, CHANNELS_SECTION_ID, BOTS_SECTION_ID, work]);
    expect(simpleSidebarSections(saved)).toEqual([BOTS_SECTION_ID, CHANNELS_SECTION_ID, home, work]);
  });

  it("keeps that default until a section is moved in Simple, then follows Simple's own saved order", () => {
    const ordered = [PINNED_SECTION_ID, CHANNELS_SECTION_ID, BOTS_SECTION_ID, work, home];
    expect(simpleOrderedSections(ordered, [])).toEqual([PINNED_SECTION_ID, BOTS_SECTION_ID, CHANNELS_SECTION_ID, work, home]);
    const moved = [CHANNELS_SECTION_ID, home, PINNED_SECTION_ID, BOTS_SECTION_ID, work];
    expect(simpleOrderedSections(ordered, moved)).toEqual(moved);
  });

  it("can move any section, the bots and group chats included, above the others", () => {
    const shown = simpleOrderedSections([CHANNELS_SECTION_ID, BOTS_SECTION_ID, work], []);
    expect(moveSection(shown, work, -1)).toEqual([BOTS_SECTION_ID, work, CHANNELS_SECTION_ID]);
    expect(placeSection(shown, CHANNELS_SECTION_ID, BOTS_SECTION_ID, "before")).toEqual([CHANNELS_SECTION_ID, BOTS_SECTION_ID, work]);
  });

  it("slots a section added after a Simple move in beside its neighbours from the default", () => {
    const saved = [work, CHANNELS_SECTION_ID, BOTS_SECTION_ID];
    expect(simpleOrderedSections([CHANNELS_SECTION_ID, BOTS_SECTION_ID, work, home], saved)).toEqual([work, home, CHANNELS_SECTION_ID, BOTS_SECTION_ID]);
  });
});

describe("the primary tile", () => {
  const bot = (id: string, extra: Partial<{ chiefOfStaff: boolean; pinned: boolean }> = {}) => ({ id, ...extra });

  it("is the Chief of Staff, pinned or not, taken out of the lists", () => {
    const parts = partitionSidebarBots([bot("chief", { chiefOfStaff: true, pinned: true }), bot("atlas", { pinned: true }), bot("bea")], { universalPins: true });
    const tiled = withPrimaryTile(parts, undefined);
    expect(tiled.primary?.id).toBe("chief");
    expect(tiled.chief).toBeNull();
    expect(tiled.pinnedBots.map((candidate) => candidate.id)).toEqual(["atlas"]);
    expect(tiled.bots.map((candidate) => candidate.id)).toEqual(["bea"]);
  });

  it("falls back to the person's MausBot", () => {
    const parts = partitionSidebarBots([bot("mausbot"), bot("bea")]);
    const tiled = withPrimaryTile(parts, "mausbot");
    expect(tiled.primary?.id).toBe("mausbot");
    expect(tiled.bots.map((candidate) => candidate.id)).toEqual(["bea"]);
    expect(withPrimaryTile(parts, undefined).primary).toBeNull();
  });
});
