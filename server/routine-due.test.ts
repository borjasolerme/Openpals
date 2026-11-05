import { describe, expect, it } from "vitest";
import { schedulerDueOf, wakeHoldOf } from "./routine-due.ts";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 24, 9, 0);
const watch = (fields: Record<string, unknown> = {}) =>
  ({ enabled: true, nextRunAt: NOW + 10 * MINUTE, checks: ["calendar", "mail", "runs"] as const, ...fields }) as Parameters<typeof wakeHoldOf>[0][number];

describe("wakeHoldOf: the desktop", () => {
  it("is held only for a meeting prep, never for the hourly check", () => {
    const horizon = 120 * MINUTE;
    expect(wakeHoldOf([watch({ checkedAt: NOW - 120 * MINUTE })], [], NOW, horizon)).toEqual({ hold: false });
    expect(wakeHoldOf([watch({ checkedAt: NOW, wakeAt: NOW + 25 * MINUTE })], [], NOW, horizon)).toEqual({ hold: true, reason: "due", at: NOW + 25 * MINUTE });
  });
});

describe("schedulerDueOf: when this process's scheduler next has work", () => {
  type Run = Parameters<typeof schedulerDueOf>[1][number];
  const run = (fields: Partial<Run>) => ({ status: "running", ...fields }) as Run;

  it("is null with nothing enabled, queued or limited", () => {
    expect(schedulerDueOf([], [], NOW, NOW)).toBeNull();
    expect(schedulerDueOf([{ enabled: false, nextRunAt: NOW }], [run({ status: "completed" }), run({ startedAt: NOW })], NOW, NOW)).toBeNull();
  });

  it("the next run, a check no sooner than checks may start, and a check's meeting wake", () => {
    expect(schedulerDueOf([{ enabled: true, nextRunAt: NOW + 5 * MINUTE }, { enabled: true, nextRunAt: NOW + 3 * MINUTE }], [], NOW, NOW)).toBe(NOW + 3 * MINUTE);
    expect(schedulerDueOf([watch({ nextRunAt: NOW - MINUTE })], [], NOW, NOW + 2 * MINUTE)).toBe(NOW + 2 * MINUTE);
    expect(schedulerDueOf([watch({ wakeAt: NOW + MINUTE })], [], NOW, NOW)).toBe(NOW + MINUTE);
    expect(schedulerDueOf([{ enabled: true, nextRunAt: null, wakeAt: NOW + MINUTE }], [], NOW, NOW)).toBeNull();
  });

  it("leaves out routines whose target is gone", () => {
    const gone = { enabled: true, nextRunAt: NOW - MINUTE, botId: "gone" };
    expect(schedulerDueOf([gone, { enabled: true, nextRunAt: NOW + MINUTE, botId: "here" }], [], NOW, NOW, (routine) => routine.botId === "gone")).toBe(NOW + MINUTE);
  });

  it("a queued run now or at its retry, and a started run when its active time reaches the limit", () => {
    expect(schedulerDueOf([], [run({ status: "queued" })], NOW, NOW)).toBe(NOW);
    expect(schedulerDueOf([], [run({ status: "queued", retryAt: NOW + MINUTE })], NOW, NOW)).toBe(NOW + MINUTE);
    expect(schedulerDueOf([], [run({ startedAt: NOW - 10 * MINUTE, timeoutMinutes: 30 })], NOW, NOW)).toBe(NOW + 20 * MINUTE);
    expect(schedulerDueOf([], [run({ status: "waiting", startedAt: NOW - 10 * MINUTE, waitedMs: 5 * MINUTE, timeoutMinutes: 30 })], NOW, NOW)).toBe(NOW + 25 * MINUTE);
    expect(schedulerDueOf([], [run({ startedAt: NOW - 40 * MINUTE, timeoutMinutes: 30 })], NOW, NOW)).toBe(NOW);
  });
});
