// The one answer to "which bot is proactive here": the Chief of Staff owns the "Keep an eye on my day" routine, the brief
// and the suggestion to add a helper-model key. Every such decision goes through this function.
import type { BotRecord, Store } from "../store.ts";

/** The Chief of Staff, if there is one. */
export function mainChief(store: Pick<Store, "bots">): BotRecord | null {
  return store.bots.find((bot) => bot.chiefOfStaff && !bot.hidden) ?? null;
}
