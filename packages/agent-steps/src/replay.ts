// Runs a recipe with no model: each step is found again on the live screen by what it is, done, and the checks are read
// at the end. A step that cannot be found or fails can be handed to `repair` once; what it returns takes the step's place
// and the recipe comes back one revision on.
import { setTimeout as delay } from "node:timers/promises";
import { fillInputs, reviseRecipe, stepLabel, stepRefusal } from "./recipe.ts";
import type { CallOutcome, Check, Driver, Patience, Policy, Recipe, Resolved, Step } from "./types.ts";

export const RETRY_MS = 3_000;
export const POLL_MS = 250;
const REAL_TIME: Patience = { now: Date.now, sleep: (ms, signal) => delay(ms, undefined, { signal }).catch(() => {}) };

export interface StepEvent {
  phase: "started" | "completed";
  index: number;
  step: Step;
  tool: string;
  label: string;
  outcome?: CallOutcome;
}

export interface RepairContext {
  recipe: Recipe;
  /** The failed step's index in the recipe; the steps before it are done. */
  index: number;
  label: string;
  error: string;
}

export interface ReplayOptions {
  /** The drivers the steps need, one per kind. */
  driver: Driver | readonly Driver[];
  /** A value for each of the recipe's inputs. */
  inputs?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  patience?: Patience;
  /** The policy the recipe must still meet (strict by default). */
  policy?: Policy;
  /** Asked before each step, after its target was found; false stops the run. */
  approve?(step: Step, index: number, label: string): Promise<boolean>;
  onStep?(event: StepEvent): void;
  /** Steps to put in place of one that failed, or nothing to give up. Asked once per run. */
  repair?(step: Step, context: RepairContext): Promise<Step[] | null | undefined>;
  now?(): number;
}

export type ReplayOutcome =
  | { kind: "done"; recipe: Recipe; repaired: boolean }
  | { kind: "declined"; index: number; tool: string; label: string }
  | { kind: "failed"; done: number; total: number; index: number; tool: string; label: string; error: string; gate?: true; check?: true }
  | { kind: "stopped" };

const STOPPED: ReplayOutcome = { kind: "stopped" };
const failure = (error: string): Extract<CallOutcome, { ok: false }> => ({ ok: false, error });

/** Finds a step, looking again for a few seconds while it is only missing (a window still opening, a page loading). */
export async function resolveSoon(driver: Driver, step: Step, signal: AbortSignal, patience: Patience = REAL_TIME): Promise<Resolved> {
  const deadline = patience.now() + RETRY_MS;
  for (;;) {
    const target = await driver.resolve(step as never, signal);
    if (target.ok || !target.missing || signal.aborted || patience.now() + POLL_MS > deadline) return target;
    await patience.sleep(POLL_MS, signal);
  }
}

async function seesSoon(driver: Driver, check: Check, signal: AbortSignal, patience: Patience): Promise<Extract<CallOutcome, { ok: false }> | null> {
  const deadline = patience.now() + RETRY_MS;
  for (;;) {
    const read = await driver.sees(check, signal);
    if (!read.ok) return read;
    if (read.seen) return null;
    if (signal.aborted || patience.now() + POLL_MS > deadline) return failure(`"${check.text}" is not visible`);
    await patience.sleep(POLL_MS, signal);
  }
}

export async function replay(recipe: Recipe, options: ReplayOptions): Promise<ReplayOutcome> {
  const drivers = Array.isArray(options.driver) ? options.driver : [options.driver as Driver];
  const signal = options.signal ?? new AbortController().signal;
  const patience = options.patience ?? REAL_TIME;
  const policy = options.policy ?? "strict";
  const now = options.now ?? Date.now;
  const steps = [...recipe.steps];
  let repaired = false;
  const driverFor = (kind: Step["driver"]) => drivers.find((driver) => driver.kind === kind);

  for (let index = 0; index < steps.length; index++) {
    if (signal.aborted) return STOPPED;
    const step = steps[index]!;
    const label = stepLabel(step);
    const failed = ({ error, gate }: Extract<CallOutcome, { ok: false }>): ReplayOutcome =>
      (signal.aborted ? STOPPED : { kind: "failed", done: index, total: steps.length, index, tool: step.tool, label, error, ...(gate ? { gate } : {}) });
    const attempt = async (): Promise<ReplayOutcome | null> => {
      const driver = driverFor(step.driver);
      if (!driver) return failed(failure(`no ${step.driver} driver to run this step`));
      let filled: Step;
      try {
        filled = fillInputs(step, options.inputs ?? {});
      } catch (error) {
        return failed(failure(error instanceof Error ? error.message : String(error)));
      }
      const target = await resolveSoon(driver, filled, signal, patience);
      if (!target.ok) return failed(target);
      if (options.approve && !(await options.approve(step, index, label))) return signal.aborted ? STOPPED : { kind: "declined", index, tool: step.tool, label };
      if (signal.aborted) return STOPPED;
      options.onStep?.({ phase: "started", index, step, tool: target.tool, label });
      const outcome = await driver.perform(target.tool, target.args, signal);
      options.onStep?.({ phase: "completed", index, step, tool: target.tool, label, outcome });
      return outcome.ok ? null : failed(outcome);
    };
    const outcome = await attempt();
    if (!outcome) continue;
    if (outcome.kind !== "failed" || outcome.gate || repaired || !options.repair) return outcome;
    repaired = true;
    const fixed = await options.repair(step, { recipe: { ...recipe, steps: [...steps] }, index, label, error: outcome.error });
    if (signal.aborted) return STOPPED;
    if (!fixed?.length || fixed.some((replacement) => stepRefusal(replacement, policy) !== null)) return outcome;
    steps.splice(index, 1, ...fixed);
    index--;
  }

  for (const check of recipe.checks) {
    if (signal.aborted) return STOPPED;
    const driver = driverFor(check.driver);
    const missed = driver ? await seesSoon(driver, check, signal, patience) : failure(`no ${check.driver} driver to read this check`);
    if (missed) {
      return signal.aborted ? STOPPED : { kind: "failed", done: steps.length, total: steps.length, index: steps.length, tool: "check", label: `"${check.text}"`, error: missed.error, check: true };
    }
  }
  return { kind: "done", recipe: repaired ? reviseRecipe(recipe, { steps }, now()) : recipe, repaired };
}
