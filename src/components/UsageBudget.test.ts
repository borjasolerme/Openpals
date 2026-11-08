import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus } from "@/state/store";
import { budgetTone, UsageBudgetCards, type BudgetState } from "./UsageBudget";

const fixture = vi.hoisted(() => ({ config: null as ConfigStatus | null }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: fixture.config }, dispatch: () => {} }),
}));
afterEach(() => vi.unstubAllGlobals());

function config(extra: Partial<ConfigStatus> = {}): ConfigStatus {
  return {
    composio: { configured: false }, box: { configured: false }, vps: { configured: false, sshAlias: "" },
    rooms: { turnTimeoutMinutes: 30 }, localVm: { mode: "shared", maxInstances: 1 },
    ...extra,
  } as ConfigStatus;
}

const budget: BudgetState = { month: "2026-09", monthlyUsd: 50, spentUsd: 42.5, percent: 85, warnAtPercent: 80, warn: true, exceeded: false };

describe("usage budget and prices cards", () => {
  it("show the cap, its warning state, and the price list", () => {
    fixture.config = config({ budgets: { monthlyUsd: 50, warnAtPercent: 80 } });
    const capped = renderToStaticMarkup(createElement(UsageBudgetCards, { budget }));
    expect(capped).toContain("Monthly spend limit");
    expect(capped).toContain("Nearing the limit");
    expect(capped).toContain("$42.50 of $50.00 (85%)");
    expect(capped).toContain('aria-valuenow="85"');

    fixture.config = config({ billing: { currency: "EUR", prices: { "claude-sonnet-5": { inputPerMillion: 4, outputPerMillion: 20 } } } });
    const both = renderToStaticMarkup(createElement(UsageBudgetCards, { budget: { ...budget, spentUsd: 50, percent: 100, exceeded: true } }));
    expect(both).toContain("Limit reached");
    expect(both).toContain("Sell prices");
    expect(both).toContain('value="claude-sonnet-5"');
    expect(both).toContain('value="EUR"');
  });

  it("says when no cap is set and tones the bar by state", () => {
    fixture.config = config();
    expect(renderToStaticMarkup(createElement(UsageBudgetCards, { budget: null }))).toContain("No limit is set");
    expect(budgetTone(null)).toBe("quiet");
    expect(budgetTone(budget)).toBe("warning");
    expect(budgetTone({ ...budget, exceeded: true })).toBe("danger");
    expect(budgetTone({ ...budget, warn: false })).toBe("quiet");
  });
});
