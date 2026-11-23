// How much of each Claude account's plan is used, as Claude Code itself reports it on every turn (`rate_limit_event`'s
// `unifiedWindows`, 2.1.330). Nothing here reads the account's login: the numbers come from turns the bots already ran.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface PlanUseWindow {
  /** 0 to 100. */
  usedPercent: number;
  /** Epoch milliseconds. */
  resetsAt: number;
}

export interface PlanUse {
  weekly?: PlanUseWindow;
  fiveHour?: PlanUseWindow;
  /** When Claude last reported it, epoch milliseconds. */
  seenAt: number;
}

const WINDOWS = { seven_day: "weekly", five_hour: "fiveHour" } as const;

/** The plan windows in one `rate_limit_info`, or null when it names none. */
export function planUseFrom(info: unknown, now: number): PlanUse | null {
  if (!info || typeof info !== "object") return null;
  const unified = (info as { unifiedWindows?: unknown }).unifiedWindows;
  if (!unified || typeof unified !== "object") return null;
  const use: PlanUse = { seenAt: now };
  for (const [name, key] of Object.entries(WINDOWS)) {
    const window = (unified as Record<string, unknown>)[name];
    if (!window || typeof window !== "object") continue;
    const { utilization, resetsAt } = window as { utilization?: unknown; resetsAt?: unknown };
    if (typeof utilization !== "number" || !Number.isFinite(utilization) || typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) continue;
    use[key] = { usedPercent: Math.min(100, Math.max(0, utilization * 100)), resetsAt: resetsAt * 1000 };
  }
  return use.weekly || use.fiveHour ? use : null;
}

/** Each account's last reported use, kept in one small file so a restart still knows it. */
export function createPlanUseStore(file: string | null, now: () => number = Date.now) {
  let known: Record<string, PlanUse> = {};
  if (file) {
    try {
      const read = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (read && typeof read === "object" && !Array.isArray(read)) known = read as Record<string, PlanUse>;
    } catch { /* first run, or an unreadable file: start empty */ }
  }
  const save = () => {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(known)}\n`, { mode: 0o600 });
      renameSync(temp, file);
    } catch { /* a lost write only means the next turn reports it again */ }
  };
  return {
    note(instanceId: string, info: unknown): void {
      const use = planUseFrom(info, now());
      if (!use) return;
      known = { ...known, [instanceId]: use };
      save();
    },
    /** What is still true now: a window that has reset since is left out, since its new use is not known yet. */
    get(instanceId: string): PlanUse | undefined {
      const use = known[instanceId];
      if (!use) return undefined;
      const at = now();
      const live = (window: PlanUseWindow | undefined) => (window && window.resetsAt > at ? window : undefined);
      const weekly = live(use.weekly);
      const fiveHour = live(use.fiveHour);
      return weekly || fiveHour ? { ...(weekly ? { weekly } : {}), ...(fiveHour ? { fiveHour } : {}), seenAt: use.seenAt } : undefined;
    },
    forget(instanceId: string): void {
      if (!Object.hasOwn(known, instanceId)) return;
      const { [instanceId]: _gone, ...rest } = known;
      known = rest;
      save();
    },
  };
}

export type PlanUseStore = ReturnType<typeof createPlanUseStore>;

let shared: PlanUseStore = createPlanUseStore(null);

/** The server opens the store on its data folder once, at start. */
export function openPlanUse(file: string): PlanUseStore {
  shared = createPlanUseStore(file);
  return shared;
}

export const planUse = (): PlanUseStore => shared;
