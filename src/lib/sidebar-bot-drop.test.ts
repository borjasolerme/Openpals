import { describe, expect, it } from "vitest";

import { botDropPlace, planBotDrop, stepBot, stepKey } from "./sidebar-bot-drop";

const ids = ["atlas", "bea", "cleo"];

describe("where a dragged bot lands", () => {
  it("goes above a row from its top half and below it from the rest", () => {
    expect([0, 26, 27, 54].map((offset) => botDropPlace(offset, 54))).toEqual(["before", "before", "after", "after"]);
  });

  it("reorders the list, in either direction, and a drop that changes nothing does nothing", () => {
    expect(planBotDrop(ids, "cleo", { kind: "row", botId: "atlas", place: "before" })).toEqual(["cleo", "atlas", "bea"]);
    expect(planBotDrop(ids, "atlas", { kind: "row", botId: "bea", place: "after" })).toEqual(["bea", "atlas", "cleo"]);
    expect(planBotDrop(ids, "atlas", { kind: "end" })).toEqual(["bea", "cleo", "atlas"]);
    expect(planBotDrop(ids, "atlas", { kind: "row", botId: "bea", place: "before" })).toBeNull();
    expect(planBotDrop(ids, "bea", { kind: "row", botId: "bea", place: "after" })).toBeNull();
    expect(planBotDrop(ids, "cleo", { kind: "end" })).toBeNull();
  });

  it("ignores a bot the list doesn't show as a row", () => {
    expect(planBotDrop(ids, "chief", { kind: "end" })).toBeNull();
    expect(planBotDrop(ids, "atlas", { kind: "row", botId: "chief", place: "before" })).toBeNull();
  });
});

describe("Alt+Up and Alt+Down", () => {
  it("move a bot one place and stop at either end", () => {
    expect(stepBot(ids, "bea", -1)).toEqual(["bea", "atlas", "cleo"]);
    expect(stepBot(ids, "bea", 1)).toEqual(["atlas", "cleo", "bea"]);
    expect(stepBot(ids, "atlas", -1)).toBeNull();
    expect(stepBot(ids, "cleo", 1)).toBeNull();
    expect(stepBot(ids, "chief", 1)).toBeNull();
  });

  it("are the only keys that move it", () => {
    const key = (key: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
      stepKey({ key, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
    expect([key("ArrowUp"), key("ArrowDown"), key("ArrowLeft"), key("ArrowUp", { altKey: false }), key("ArrowDown", { shiftKey: true }), key("ArrowUp", { metaKey: true })])
      .toEqual([-1, 1, null, null, null, null]);
  });
});
