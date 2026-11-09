// Security invariant: work from outside (a webhook or an app's event) never borrows a person's level. A run or a hand-off
// ends; the words that came in stay in the conversation, so once work traces to outside, that conversation and what it hands
// on keep a record of it, and the record holds after the run ends and after a restart (docs/runtime-contract.md §3).
import type { HandoffView } from "../coordinator.ts";
import { outsideDriven } from "../outside-driven.ts";
import type { RoutineRun } from "../routines.ts";
import type { Store } from "../store.ts";

const MAX_HOPS = 32;

export interface OutsideLineageDeps {
  store: Pick<Store, "botByThread" | "taskByThread" | "patchTask" | "messagesFor">;
  activeRun(threadId: string): RoutineRun | null;
  // Read lazily: index.ts builds the coordinator after this module.
  node(id: string): HandoffView | undefined;
  active(): HandoffView[];
}

export function createOutsideLineage(deps: OutsideLineageDeps) {
  const { store } = deps;

  const marked = (threadId: string): boolean => {
    const bot = store.botByThread(threadId);
    return Boolean(bot && store.taskByThread(bot.id, threadId)?.outside);
  };
  /** Once only, and for good: nothing clears it. A room's thread has no record of its own: a payload posted into it is. */
  const mark = (threadId: string): void => {
    const bot = store.botByThread(threadId);
    if (bot && !store.taskByThread(bot.id, threadId)?.outside) store.patchTask(bot.id, threadId, { outside: true });
  };

  /** The conversations that handed this work on, however deep. */
  function handedFrom(nodeId: string | undefined): string[] {
    const sources: string[] = [];
    let node = nodeId ? deps.node(nodeId) : undefined;
    for (let steps = 0; node && steps < MAX_HOPS; steps++) {
      if (node.id !== nodeId) sources.push(node.threadId);
      if (node.id === node.rootId) break;
      node = deps.node(node.parentId ?? node.rootId);
    }
    return sources;
  }

  /** A webhook or app event drove this conversation: its record, its run, a payload posted into it, or a conversation that handed it the work. */
  const outsideDrivenThread = (threadId: string): boolean => outsideDriven(threadId, {
    marked,
    webhookRun: (id) => deps.activeRun(id)?.triggerSource === "webhook",
    webhookPosted: (id) => store.messagesFor(id).some((line) => line.webhookPost),
    handedFrom: (id) => deps.active().filter((node) => node.threadId === id).flatMap((node) => handedFrom(node.id)),
  });

  /** Everything this conversation hands on keeps its record. */
  const carry = (fromThreadId: string, toThreadId: string): void => {
    if (outsideDrivenThread(fromThreadId)) mark(toThreadId);
  };

  /** A level comes down a hand-off only from work a person or their routine started. */
  const handsNoLevel = (threadId: string): boolean => outsideDrivenThread(threadId);

  /** At every start: what ran without a record of its own, or was still in flight, keeps its lineage. */
  function settle(runs: readonly RoutineRun[]): void {
    for (const run of runs) {
      // A wait's follow-up runs in the person's own chat, which stays theirs.
      if (run.triggerSource === "webhook" && run.threadId && run.eventSource !== "wait") mark(run.threadId);
    }
    for (const node of deps.active()) {
      if (handedFrom(node.id).some((threadId) => outsideDrivenThread(threadId))) mark(node.threadId);
    }
  }

  return { mark, carry, settle, handsNoLevel, outsideDrivenThread };
}
