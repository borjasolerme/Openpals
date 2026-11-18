import { describe, expect, it } from "vitest";
import { completeWindowState, windowState } from "../testing/cua-fixtures.ts";
import type { Caller, CallOutcome, CuaStep } from "../types.ts";
import { cuaDriver } from "./driver.ts";

const TEXTEDIT = { bundleId: "com.apple.TextEdit", name: "TextEdit" };
const signal = new AbortController().signal;
const desktop = (label = "Save"): Caller => ({
  async call(tool): Promise<CallOutcome> {
    if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: 4242, name: "TextEdit", bundle_id: "com.apple.TextEdit", running: true }] } };
    if (tool === "list_windows") return { ok: true, structured: { windows: [{ window_id: 7, pid: 4242, title: "Untitled", app_name: "TextEdit" }] } };
    const state = windowState(2);
    return { ok: true, structured: completeWindowState({ ...state, elements: state.elements!.map((element) => (element.label === "Save" ? { ...element, label } : element)) }, "Dear Ana") };
  },
});
const SAVE: CuaStep = { driver: "cua", tool: "click", args: {}, app: TEXTEDIT, window: { title: "Untitled" }, element: { role: "AXButton", label: "Save", path: [] }, hint: { x: 40, y: 12 } };

describe("cuaDriver", () => {
  it("clicks a recorded point only when asked to and the element is gone", async () => {
    expect(await cuaDriver(desktop("Keep")).resolve(SAVE, signal)).toMatchObject({ ok: false, missing: true });
    expect(await cuaDriver(desktop("Keep"), { hints: true }).resolve(SAVE, signal)).toEqual({ ok: true, tool: "click", args: { pid: 4242, window_id: 7, x: 40, y: 12 } });
    expect(await cuaDriver(desktop(), { hints: true }).resolve(SAVE, signal)).toEqual({ ok: true, tool: "click", args: { pid: 4242, window_id: 7, element_token: "s2-e3" } });
  });

  it("reads a check from the window's labels and values", async () => {
    const check = { kind: "text-visible" as const, driver: "cua" as const, app: TEXTEDIT, window: { title: "Untitled" } };
    expect(await cuaDriver(desktop()).sees({ ...check, text: "Dear Ana" }, signal)).toEqual({ ok: true, seen: true });
    expect(await cuaDriver(desktop()).sees({ ...check, text: "Invoice" }, signal)).toEqual({ ok: true, seen: false });
    expect(await cuaDriver(desktop()).sees({ kind: "text-visible", driver: "cua", text: "Dear" }, signal)).toMatchObject({ ok: false });
  });

  it("can only learn without a caller", async () => {
    await expect(cuaDriver().resolve(SAVE, signal)).rejects.toThrow(/without a caller/);
  });
});
