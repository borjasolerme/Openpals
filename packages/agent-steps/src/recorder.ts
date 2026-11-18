// Records tool calls as they happen and turns them into a recipe at the end.
import { randomUUID } from "node:crypto";
import { slimResponse } from "./cua/wire.ts";
import { learnRecipe } from "./recipe.ts";
import type { CallOutcome, Check, Driver, Policy, Recipe, RecordedCall, RecordedResult, Refusal, Step } from "./types.ts";

/** Text kept from one answer: a long page's snapshot, not an endless log. */
export const MAX_TEXT = 200_000;

export interface Recorder {
  /** Keeps a call made elsewhere. */
  record(call: RecordedCall): void;
  /** Makes a call through the driver that owns the tool, and keeps it. */
  call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallOutcome>;
  calls(): readonly RecordedCall[];
  /** The recipe the calls make, or why they make none. `checks`: text that must be visible after the steps. */
  stop(options: { name: string; inputs?: Readonly<Record<string, string>>; checks?: ReadonlyArray<string | Check> }): { ok: true; recipe: Recipe } | { ok: false; reason: Refusal };
}

/** Snapshot lines (`- role "name"`) and the page's address: all a browser step is learned from. */
const KEPT_LINE = /^\s*- |^\s*(?:page )?url:/iu;

/** What a recorder keeps of an answer: cua's structure without values or images, a browser's snapshot lines. */
export function recordedResult(outcome: CallOutcome, kind: Driver["kind"]): RecordedResult {
  if (!outcome.ok) return { isError: true };
  if (kind === "cua") return slimResponse({ result: { structuredContent: outcome.structured } });
  const text = outcome.text?.trim() ?? "";
  // get_url answers with the address alone.
  const kept = /^https?:\/\/\S+$/u.test(text) ? text : text.split("\n").filter((line) => KEPT_LINE.test(line)).join("\n");
  return { isError: false, ...(kept ? { text: kept.slice(0, MAX_TEXT) } : {}) };
}

/** A check on the screen the last step acted on. */
function checkAfter(text: string, steps: readonly Step[]): Check {
  const last = steps.at(-1);
  if (last?.driver === "cua") {
    const placed = [...steps].reverse().find((step): step is Extract<Step, { driver: "cua" }> => step.driver === "cua" && step.window !== undefined);
    return { kind: "text-visible", driver: "cua", text, ...(placed?.app ? { app: placed.app } : {}), ...(placed?.window ? { window: placed.window } : {}) };
  }
  return { kind: "text-visible", driver: "agent-browser", text };
}

export function createRecorder(options: { driver: Driver | readonly Driver[]; policy?: Policy; now?: () => number; id?: () => string }): Recorder {
  const drivers = Array.isArray(options.driver) ? options.driver : [options.driver as Driver];
  const calls: RecordedCall[] = [];
  return {
    record: (call) => { calls.push(call); },
    async call(tool, args, signal = new AbortController().signal) {
      const driver = drivers.find((candidate) => candidate.owns(tool));
      if (!driver) return { ok: false, error: `no driver for ${tool}` };
      const outcome = await driver.perform(tool, args, signal);
      calls.push({ tool, arguments: args, result: recordedResult(outcome, driver.kind) });
      return outcome;
    },
    calls: () => calls,
    stop({ name, inputs, checks }) {
      const now = (options.now ?? Date.now)();
      const learned = learnRecipe({ calls, drivers, request: name, policy: options.policy ?? "standard", id: (options.id ?? randomUUID)(), now, ...(inputs ? { inputs } : {}) });
      if (!learned.ok || !checks?.length) return learned;
      const { recipe } = learned;
      return { ok: true, recipe: { ...recipe, checks: checks.map((check) => (typeof check === "string" ? checkAfter(check, recipe.steps) : check)) } };
    },
  };
}
