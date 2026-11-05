import { useSyncExternalStore } from "react";

import { chiefScope, type OwnedBot } from "../../shared/bot-owner";
import type { DefaultBotFields } from "../../shared/default-bot";

export { DEFAULT_BOT_NAME } from "../../shared/default-bot";

export function defaultBotIn<T extends DefaultBotFields>(bots: readonly T[]): T | undefined {
  return bots.find((bot) => bot.defaultBot);
}

type ChiefCandidate = DefaultBotFields & OwnedBot & { id: string; hidden?: boolean };

/** The Chief of Staff in MausBot's department, if one is there to see. */
export function chiefFor<T extends ChiefCandidate>(bots: readonly T[], maus: T | undefined): T | undefined {
  const scope = chiefScope(maus ?? {});
  return bots.find((bot) => bot.chiefOfStaff && !bot.hidden && chiefScope(bot) === scope);
}

/** What starting with MausBot saves on it: seen, in the sidebar, and the Chief only where there is none, so a Chief
 * someone already has is never replaced. */
export function createChiefPatch(maus: DefaultBotFields, chief: { id: string } | undefined): { welcomed: true; sidebarHidden?: false; chiefOfStaff?: true } {
  return { welcomed: true, ...(maus.sidebarHidden ? { sidebarHidden: false as const } : {}), ...(chief ? {} : { chiefOfStaff: true as const }) };
}

export type SetupStep = "ai" | "bots" | "apps" | "phone";

/** What MausBot's intro offers to set up in Advanced mode, each optional: only what is still to do, and on a place with
 * bots of the person's own only an AI, which nothing works without. */
export function setupSteps(input: { aiReady: boolean; ownBots: number }): SetupStep[] {
  const fresh = input.ownBots === 0;
  return [
    ...(input.aiReady ? [] : ["ai" as const]),
    ...(fresh ? ["bots" as const, "apps" as const, "phone" as const] : []),
  ];
}

export type IntroChip = "ai" | "apps" | "import" | "phone";

export interface IntroFacts {
  aiReady: boolean;
  ownBots: number;
  /** Known to have a connected app or a paired phone; unknown counts as not yet. */
  appsConnected?: boolean;
  phonePaired?: boolean;
  /** This computer has skills or MCP servers from another AI tool to bring in. */
  importFound?: boolean;
}

/** At most this many chips under MausBot's look around: a step done or tapped leaves, and the next takes its place. */
export const INTRO_CHIPS = 3;

/** The chips under MausBot's look around (Simple mode), in order, before the cap: what is still missing, and on a place
 * with bots of the person's own only an AI. Adding a bot lives on the sidebar's +. */
export function introChips(input: IntroFacts): IntroChip[] {
  const fresh = input.ownBots === 0;
  return [
    ...(input.aiReady ? [] : ["ai" as const]),
    ...(fresh && !input.appsConnected ? ["apps" as const] : []),
    ...(fresh && input.importFound ? ["import" as const] : []),
    ...(fresh && !input.phonePaired ? ["phone" as const] : []),
  ];
}

let welcoming: string | null = null;
const welcomingListeners = new Set<() => void>();

/** The MausBot being introduced (its first-launch card, or the first run's Chief screen): kept out of the sidebar and
 * its chat says nothing yet, until it lands. */
export function setWelcomingBot(id: string | null): void {
  if (welcoming === id) return;
  welcoming = id;
  for (const listener of welcomingListeners) listener();
}

export function useWelcomingBot(): string | null {
  return useSyncExternalStore((listener) => {
    welcomingListeners.add(listener);
    return () => welcomingListeners.delete(listener);
  }, () => welcoming, () => null);
}

let staged: string | null = null;

/** The bot whose first messages arrive one at a time, as a first run lands in its chat; null once they have. */
export function stageIntro(botId: string | null): void {
  staged = botId;
}

export function introStaged(botId: string): boolean {
  return staged === botId;
}
