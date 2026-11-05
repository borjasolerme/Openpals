// The one answer to "which bot is proactive here": it owns the "Keep an eye on my day" routine, the brief and the
// suggestion to add a helper-model key. That is the place's MausBot, shown in the sidebar or not, and the main Chief of
// Staff only where there is no MausBot. Every such decision goes through this function.
import type { BotRecord, Store } from "../store.ts";

/** The Chief of Staff, if there is one. */
export function mainChief(store: Pick<Store, "bots">): BotRecord | null {
  return store.bots.find((bot) => bot.chiefOfStaff && !bot.hidden) ?? null;
}

export function proactiveOwner(store: Pick<Store, "bots">): BotRecord | null {
  return store.bots.find((bot) => bot.defaultBot && !bot.hidden) ?? mainChief(store);
}
