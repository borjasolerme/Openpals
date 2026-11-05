// The one answer to "which bot is proactive here": it owns the "Keep an eye on my day" routine, the brief and the
// suggestion to add a helper-model key. That is the place's MausBot, shown in the sidebar or not, and the main Chief of
// Staff only where there is no MausBot. Every such decision goes through this function.
import { sectionKey, type BotRecord, type Store } from "../store.ts";

/** The Chief of the whole workspace, or the first Chief there is. */
export function mainChief(store: Pick<Store, "bots">): BotRecord | null {
  const chiefs = store.bots.filter((bot) => bot.chiefOfStaff && !bot.hidden);
  return chiefs.find((bot) => sectionKey(bot.section) === "") ?? chiefs[0] ?? null;
}

export function proactiveOwner(store: Pick<Store, "bots">): BotRecord | null {
  return store.bots.find((bot) => bot.defaultBot && !bot.hidden) ?? mainChief(store);
}
