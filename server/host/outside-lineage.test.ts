import { describe, expect, it } from "vitest";

import type { HandoffView } from "../coordinator.ts";
import type { RoutineRun } from "../routines.ts";
import { createOutsideLineage, type OutsideLineageDeps } from "./outside-lineage.ts";

function world() {
  const tasks = new Map<string, { threadId: string; outside?: true }>();
  for (const threadId of ["chat", "hook-run", "teammate", "person-work"]) tasks.set(threadId, { threadId });
  const lines = new Map<string, Array<Record<string, unknown>>>();
  const nodes = new Map<string, HandoffView>();
  const runs = new Map<string, RoutineRun>();
  const store = {
    botByThread: (threadId: string) => (tasks.has(threadId) ? { id: "bot" } : null),
    taskByThread: (_botId: string, threadId: string) => tasks.get(threadId),
    patchTask: (_botId: string, threadId: string, patch: { outside?: true }) => { Object.assign(tasks.get(threadId)!, patch); },
    messagesFor: (threadId: string) => lines.get(threadId) ?? [],
  } as unknown as OutsideLineageDeps["store"];
  const lineage = createOutsideLineage({
    store, activeRun: (threadId) => runs.get(threadId) ?? null, node: (id) => nodes.get(id), active: () => [...nodes.values()],
  });
  return { lineage, tasks, lines, nodes, runs };
}
const webhookRun = (threadId: string, more: Partial<RoutineRun> = {}) => ({ id: "run-1", routineId: "hook", routineName: "Inbox", botId: "bot", threadId, status: "running", triggerSource: "webhook", ...more }) as RoutineRun;

describe("work from outside stays with that work", () => {
  it("keeps a conversation's record after its run has ended, for good", () => {
    const w = world();
    w.runs.set("hook-run", webhookRun("hook-run"));
    expect(w.lineage.handsNoLevel("hook-run")).toBe(true);
    w.lineage.mark("hook-run");
    w.runs.delete("hook-run");
    expect(w.lineage.handsNoLevel("hook-run")).toBe(true);
    expect(w.lineage.outsideDrivenThread("hook-run")).toBe(true);
    expect(w.lineage.handsNoLevel("chat")).toBe(false);
  });

  it("counts a conversation a webhook posted into", () => {
    const w = world();
    w.lines.set("chat", [{ role: "bot", webhookPost: true }]);
    expect(w.lineage.handsNoLevel("chat")).toBe(true);
    expect(w.lineage.handsNoLevel("person-work")).toBe(false);
  });

  it("carries the record to what a marked conversation hands on, and no further than that", () => {
    const w = world();
    w.lineage.mark("hook-run");
    w.lineage.carry("hook-run", "teammate");
    expect(w.tasks.get("teammate")?.outside).toBe(true);
    w.lineage.carry("chat", "person-work");
    expect(w.tasks.get("person-work")?.outside).toBeUndefined();
  });

  it("counts work handed on from a marked conversation while the hand-off is in flight", () => {
    const w = world();
    w.lineage.mark("hook-run");
    w.nodes.set("root", { id: "root", rootId: "root", threadId: "hook-run", botId: "bot", status: "waiting" } as HandoffView);
    w.nodes.set("kid", { id: "kid", rootId: "root", parentId: "root", threadId: "teammate", botId: "bot", status: "running" } as HandoffView);
    expect(w.lineage.handsNoLevel("teammate")).toBe(true);
    expect(w.lineage.handsNoLevel("person-work")).toBe(false);
  });

  it("settles at each start from what ran before: own run threads and work still handed on", () => {
    const w = world();
    w.nodes.set("root", { id: "root", rootId: "root", threadId: "hook-run", botId: "bot", status: "waiting" } as HandoffView);
    w.nodes.set("kid", { id: "kid", rootId: "root", parentId: "root", threadId: "teammate", botId: "bot", status: "queued" } as HandoffView);
    w.lineage.settle([webhookRun("hook-run")]);
    expect(w.tasks.get("hook-run")?.outside).toBe(true);
    expect(w.tasks.get("teammate")?.outside).toBe(true);
    expect(w.tasks.get("person-work")?.outside).toBeUndefined();
  });

  it("leaves the chat a wait's follow-up ran in as it was", () => {
    const w = world();
    w.lineage.settle([webhookRun("chat", { eventSource: "wait" })]);
    expect(w.tasks.get("chat")?.outside).toBeUndefined();
  });
});
