import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { activeLocale, loadLocale, setLocale, t } from "@/lib/i18n";
import {
  TASK_PICKER_DISMISS_MS,
  filterTasks,
  taskPickerPointerIntent,
} from "./TaskPicker";

describe("taskPickerPointerIntent", () => {
  it("treats a single click as switch, not rename", () => {
    expect(taskPickerPointerIntent("click", 1)).toBe("select");
    expect(taskPickerPointerIntent("click")).toBe("select");
  });

  it("does not let the click that accompanies a double-click close the row", () => {
    // HTML fires click (detail=1), click (detail=2), then dblclick; closing on the first unmounts the menu before
    // rename starts.
    expect(taskPickerPointerIntent("click", 2)).toBe("ignore");
    expect(taskPickerPointerIntent("dblclick", 2)).toBe("rename");
  });

  it("starts a rename from right-click", () => {
    expect(taskPickerPointerIntent("contextmenu")).toBe("rename");
  });

  it("ignores unrelated events", () => {
    expect(taskPickerPointerIntent("mousedown")).toBe("ignore");
  });
});

describe("task picker copy", () => {
  it("advertises both gestures the row actually handles", () => {
    expect(t("task.renameHint")).toContain("double-click");
    expect(t("task.renameHint")).toContain("right-click");
    expect(TASK_PICKER_DISMISS_MS).toBeGreaterThanOrEqual(500);
  });
});

describe("filterTasks", () => {
  let previousLocale: string;
  beforeEach(() => { previousLocale = activeLocale(); });
  afterEach(() => { setLocale(previousLocale); });

  it.each([
    ["zh", "New thread", "新建对话"],
    ["zh-tw", "New thread", "新增對話"],
  ])("matches %s display title for %s while preserving raw search and prefix ranking", async (locale, raw, displayed) => {
    expect(await loadLocale(locale)).toBe(locale);
    const candidates = [
      { title: `归档${displayed}` },
      { title: raw },
      { title: `${displayed} notes` },
      { title: `Archived ${raw}` },
      { title: `${raw} notes` },
    ];
    expect(filterTasks(candidates, ` ${displayed} `)).toEqual([candidates[1], candidates[2], candidates[0]]);
    expect(filterTasks(candidates, displayed.slice(1))).toEqual(candidates.slice(0, 3));
    expect(filterTasks(candidates, raw.toUpperCase())).toEqual([candidates[1], candidates[4], candidates[3]]);
  });

  const tasks = [
    { title: "Clean up" },
    { title: "OpenMausBot Update" },
    { title: "Investment report" },
    { title: "Report drafts" },
  ];

  it("returns the original order when the query is empty", () => {
    expect(filterTasks(tasks, "").map((task) => task.title)).toEqual(tasks.map((task) => task.title));
    expect(filterTasks(tasks, "   ").map((task) => task.title)).toEqual(tasks.map((task) => task.title));
  });

  it("matches titles case-insensitively", () => {
    expect(filterTasks(tasks, "openmaus").map((task) => task.title)).toEqual(["OpenMausBot Update"]);
  });

  it("ranks prefix hits ahead of substring hits, keeping input order in each tier", () => {
    expect(filterTasks(tasks, "report").map((task) => task.title)).toEqual([
      "Report drafts",
      "Investment report",
    ]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterTasks(tasks, "zzzz")).toEqual([]);
  });
});
