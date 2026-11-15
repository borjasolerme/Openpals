// Where a bot works: a Boat cloud computer, a computer of the owner's lent to this server (a Mac mini, a laptop), or
// the server itself. The choice is a bot patch; the lent computers come from /api/work-computers.
import { useEffect, useState } from "react";
import { api, type Bot } from "@/state/store";
import type { BotUpdatePatch } from "@/state/bot-patch-queue";

export interface WorkComputer {
  id: string;
  name: string;
  platform: "darwin" | "win32" | "linux" | null;
  online: boolean;
  busy: boolean;
  /** Still lent: false once its owner stopped lending there. */
  lent: boolean;
  paused: boolean;
  lastSeenAt: number;
  lastUsedAt: number | null;
  scopes: { folders: number; terminal: boolean; screen: boolean };
}

export type WorkComputerState = "online" | "busy" | "paused" | "offline" | "stopped";

export function workComputerState(computer: Pick<WorkComputer, "online" | "busy" | "paused" | "lent">): WorkComputerState {
  if (computer.online) return computer.busy ? "busy" : "online";
  if (!computer.lent) return "stopped";
  return computer.paused ? "paused" : "offline";
}

/** The simple choices the new-bot step offers first; "other" is any place set from More options (`computer` null:
 * Auto). */
export type WorkChoice = { kind: "boat" } | { kind: "mac"; id: string } | { kind: "server" } | { kind: "other"; computer?: Bot["computer"] | null };

export type WorkPatch = Pick<BotUpdatePatch, "computer" | "cloudBackend" | "lentComputerId">;

export function workPatch(choice: WorkChoice): WorkPatch {
  if (choice.kind === "other") return { computer: choice.computer ?? null };
  if (choice.kind === "boat") return { computer: "cloud", cloudBackend: "box" };
  if (choice.kind === "mac") return { computer: "cloud", cloudBackend: "lent", lentComputerId: choice.id };
  return { computer: "browser" };
}

export function workChoiceOf(bot: Pick<Bot, "computer" | "cloudBackend" | "lentComputerId">): WorkChoice {
  if (bot.computer === "cloud" && bot.cloudBackend === "lent" && bot.lentComputerId) return { kind: "mac", id: bot.lentComputerId };
  if (bot.computer === "cloud" && (bot.cloudBackend ?? "box") === "box") return { kind: "boat" };
  if (bot.computer === "browser") return { kind: "server" };
  return { kind: "other", computer: bot.computer ?? null };
}

export function sameChoice(a: WorkChoice, b: WorkChoice): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "mac") return a.id === (b as typeof a).id;
  if (a.kind === "other") return (a.computer ?? null) === ((b as typeof a).computer ?? null);
  return true;
}

export async function listWorkComputers(request: typeof api = api): Promise<WorkComputer[] | null> {
  try {
    const answer = await request<{ computers?: WorkComputer[] }>("/api/work-computers");
    return Array.isArray(answer.computers) ? answer.computers : [];
  } catch {
    // A server where others sign in, or a page without the owner's rights, lends no computers.
    return null;
  }
}

export function renameWorkComputer(id: string, name: string, request: typeof api = api) {
  return request<{ computer: WorkComputer | null }>(`/api/work-computers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function forgetWorkComputer(id: string, request: typeof api = api) {
  return request(`/api/work-computers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type ConnectionTest = { ok: true; image?: { mimeType: string; data: string } } | { ok: false; error: string };

export function testWorkComputer(id: string, request: typeof api = api): Promise<ConnectionTest> {
  return request<ConnectionTest>(`/api/work-computers/${encodeURIComponent(id)}/test`, { method: "POST", body: "{}" });
}

/** How often an open picker or guide reads the list again, so a Mac turned on elsewhere shows up by itself. */
export const WORK_COMPUTERS_POLL_MS = 3_000;

/** The lent computers, read again every few seconds while `live`; null when this server lends none to this page. */
export function useWorkComputers(live = true, request: typeof api = api): { computers: WorkComputer[] | null; loaded: boolean; refresh: () => void } {
  const [computers, setComputers] = useState<WorkComputer[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const read = () => void listWorkComputers(request).then((list) => {
      if (cancelled) return;
      setComputers(list);
      setLoaded(true);
    });
    read();
    if (!live) return () => { cancelled = true; };
    const timer = setInterval(read, WORK_COMPUTERS_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [live, request, tick]);
  return { computers, loaded, refresh: () => setTick((value) => value + 1) };
}
