import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPlanUseStore, planUseFrom } from "./claude-plan-use.ts";

// The frame Claude Code 2.1.330 sends at the start of every turn.
const INFO = {
  status: "allowed", resetsAt: 1795451400, rateLimitType: "five_hour", isUsingOverage: false,
  unifiedWindows: {
    five_hour: { utilization: 0.12, resetsAt: 1795451400, status: "allowed" },
    seven_day: { utilization: 0.345, resetsAt: 1795654800, status: "allowed" },
  },
};
const BEFORE_RESETS = 1795400000000;

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("Claude plan use", () => {
  it("reads the weekly and 5-hour windows Claude reports, as percent and milliseconds", () => {
    expect(planUseFrom(INFO, 1)).toEqual({
      seenAt: 1,
      weekly: { usedPercent: 34.5, resetsAt: 1795654800000 },
      fiveHour: { usedPercent: 12, resetsAt: 1795451400000 },
    });
  });

  it("reads nothing from a frame without plan windows or with broken numbers", () => {
    expect(planUseFrom({ status: "allowed" }, 1)).toBeNull();
    expect(planUseFrom(null, 1)).toBeNull();
    expect(planUseFrom({ unifiedWindows: { seven_day: { utilization: "a lot", resetsAt: 5 } } }, 1)).toBeNull();
  });

  it("keeps each account's last report across a restart, and leaves out a window that has reset since", () => {
    dir = mkdtempSync(join(tmpdir(), "plan-use-"));
    const file = join(dir, "claude-plan-use.json");
    let clock = BEFORE_RESETS;
    createPlanUseStore(file, () => clock).note("claude-a", INFO);
    const reopened = createPlanUseStore(file, () => clock);
    expect(reopened.get("claude-a")?.weekly?.usedPercent).toBe(34.5);
    expect(reopened.get("claude-b")).toBeUndefined();
    clock = 1795451400000 + 1;
    expect(reopened.get("claude-a")).toEqual({ weekly: { usedPercent: 34.5, resetsAt: 1795654800000 }, seenAt: BEFORE_RESETS });
    clock = 1795654800000 + 1;
    expect(reopened.get("claude-a")).toBeUndefined();
    expect(readFileSync(file, "utf8")).not.toMatch(/token|email/u);
  });
});
