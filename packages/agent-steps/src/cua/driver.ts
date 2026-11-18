// The desktop driver: Cua's computer tools (list_apps, list_windows, get_window_state, click, set_value, ...), reached
// through whatever Caller the host gives it. Each step is found afresh by get_window_state and its element's identity.
import type { Caller, Check, CuaStep, Driver } from "../types.ts";
import { resolveStep } from "./resolve.ts";
import { cuaLabel, cuaOwns, cuaRefusal, cuaWords, learnCua } from "./rules.ts";

export interface CuaDriverOptions {
  /** When an element is gone, click the point it was recorded at. Off by default: a point is only a last resort. */
  hints?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every label and value the window shows. */
function windowText(state: Record<string, unknown>): string[] {
  const elements = Array.isArray(state.elements) ? state.elements : [];
  return elements.flatMap((element) => (isRecord(element) ? [element.label, element.value].filter((text): text is string => typeof text === "string") : []));
}

export function cuaDriver(caller?: Caller, options: CuaDriverOptions = {}): Driver<CuaStep> {
  const live = (): Caller => {
    if (!caller) throw new Error("this cua driver was made without a caller, so it can only learn");
    return caller;
  };
  return {
    kind: "cua",
    owns: cuaOwns,
    learn: learnCua,
    refusal: cuaRefusal,
    words: cuaWords,
    label: cuaLabel,
    async resolve(step, signal) {
      const found = await resolveStep(step, live(), signal);
      if (found.ok || !found.missing || !options.hints || !step.hint || step.tool !== "click" || !step.element) return found;
      const { element: _element, ...windowOnly } = step;
      const place = await resolveStep(windowOnly, live(), signal);
      return place.ok ? { ok: true, tool: step.tool, args: { ...place.args, x: step.hint.x, y: step.hint.y } } : found;
    },
    perform: (tool, args, signal) => live().call(tool, args, signal),
    async sees(check: Check, signal) {
      if (!check.app || !check.window) return { ok: false, error: "a desktop check names the app and window to read" };
      const place = await resolveStep({ driver: "cua", tool: "scroll", args: {}, app: check.app, window: check.window }, live(), signal);
      if (!place.ok) return place;
      const state = await live().call("get_window_state", { pid: place.args.pid, window_id: place.args.window_id, include_screenshot: false }, signal);
      if (!state.ok) return state;
      return { ok: true, seen: windowText(state.structured).some((text) => text.includes(check.text)) };
    },
  };
}
