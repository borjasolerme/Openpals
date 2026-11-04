// What a bot may read about the usage limits of the AI accounts it can run on: percent used, reset time and when that was
// checked, per account. Rows are built field by field from the plan-usage report, so no token, account id, sign-in folder
// or address can reach a model. Security: an account kept in another person's engine home is never listed to a turn.

import type { InstanceConfigMap, ProviderSnapshot } from "./contracts.ts";
import type { PlanProviderRow, PlanUsageReport, PlanWindow } from "./plan-usage.ts";

export interface EngineLimitWindow {
  name: string;
  usedPercent: number;
  /** ISO time, or null when the account did not say. */
  resetsAt: string | null;
}

/** `ok`: `windows` hold what the account reported. `unknown`: it reports limits, but there is no data right now (`why` says
 * what to do). `unsupported`: this kind of account reports no limits to this app at all. */
export interface EngineLimitAccount {
  account: string;
  engine: string;
  status: "ok" | "unknown" | "unsupported";
  plan?: string;
  /** When the numbers were read from the provider; the same read may serve calls for up to a minute. Null when never asked. */
  checkedAt: string | null;
  windows: EngineLimitWindow[];
  why?: string;
}

export interface EngineLimitInstance {
  instanceId: string;
  displayName?: string;
  driverKind: string;
  enabled: boolean;
}

const REPORTING_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex", "grokAgent"]);
const UNSUPPORTED_WHY = "This AI does not report usage limits to this app.";
const NO_WINDOWS_WHY = "The account answered but reported no usage windows.";
const NOT_CHECKED_WHY = "Usage could not be checked just now. Try again later.";

const percent = (value: number) => Math.round(value * 10) / 10;

function rowWindows(row: PlanProviderRow): EngineLimitWindow[] {
  const line = (name: string, window: PlanWindow): EngineLimitWindow[] => window.available && window.usedPercent !== null
    ? [{ name, usedPercent: percent(window.usedPercent), resetsAt: window.resetsAt }] : [];
  return [
    ...line("5-hour", row.fiveHour),
    ...line("weekly", row.weekly),
    ...row.extra.map((extra) => ({ name: extra.label, usedPercent: percent(extra.usedPercent), resetsAt: extra.resetsAt })),
    ...row.models.flatMap((model) => model.windows.map((entry) => ({ name: `${model.name} ${entry.label}`, usedPercent: percent(entry.usedPercent), resetsAt: entry.resetsAt }))),
  ];
}

/** A person may have named an account after their address. */
const shownName = (instance: EngineLimitInstance) => {
  const name = instance.displayName?.trim();
  return name && !name.includes("@") ? name : instance.driverKind;
};

export function engineLimitsFor(input: {
  instances: readonly EngineLimitInstance[];
  configs: InstanceConfigMap;
  status: (instanceId: string) => ProviderSnapshot | undefined;
  /** Null when the read failed. */
  report: PlanUsageReport | null;
}): EngineLimitAccount[] {
  const { report } = input;
  const seen = new Map<string, number>();
  return input.instances.flatMap((instance): EngineLimitAccount[] => {
    const snapshot = input.status(instance.instanceId);
    if (!instance.enabled || snapshot?.state !== "available") return [];
    const base = (() => {
      const name = shownName(instance), count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      return { account: count > 1 ? `${name} ${count}` : name, engine: instance.driverKind };
    })();
    if (!REPORTING_DRIVERS.has(instance.driverKind) || snapshot.billing === "metered") {
      return snapshot.authenticated === false ? [] : [{ ...base, status: "unsupported", checkedAt: null, windows: [], why: UNSUPPORTED_WHY }];
    }
    if (!report) return [{ ...base, status: "unknown", checkedAt: null, windows: [], why: NOT_CHECKED_WHY }];
    const row = report.providers.find((candidate) => candidate.id === instance.instanceId);
    if (!row) return [{ ...base, status: "unsupported", checkedAt: null, windows: [], why: UNSUPPORTED_WHY }];
    if (!row.ok) return [{ ...base, status: "unknown", checkedAt: report.fetchedAt, windows: [], why: row.error ?? NOT_CHECKED_WHY }];
    const windows = rowWindows(row);
    const plan = row.plan ? { plan: row.plan } : {};
    return [windows.length
      ? { ...base, ...plan, status: "ok", checkedAt: report.fetchedAt, windows }
      : { ...base, ...plan, status: "unknown", checkedAt: report.fetchedAt, windows: [], why: NO_WINDOWS_WHY }];
  });
}
