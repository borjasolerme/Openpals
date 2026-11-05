import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { DEFAULT_BOT_COLOR, DEFAULT_BOT_NAME, LEGACY_DEFAULT_BOT_NAME } from "../shared/default-bot.ts";
import { takeImportName } from "../shared/import-name.ts";
import type { BotRecord, Message, Store } from "./store.ts";

export type DefaultBotStore = Pick<Store, "bots" | "bot" | "createBot" | "patchBot" | "appendMessage" | "messagesFor" | "createTask" | "setChiefOfStaff">;

/** Where this place (key "") is recorded as having had its MausBot, so one that is gone is never made twice. */
const LEDGER = "default-bot.json";

/** The colour a new install gave its MausBot before Chrome, which an adopted MausBot trades for Chrome. */
const STARTER_COLOR = "silver";

export const HELPER_ASKS = ["What are my bots up to?", "Set up a bot for my inbox", "Make me a morning routine", "How do I connect my email?"];

export function defaultBotRefusal(name: string): string {
  return `${name} can't be deleted or archived. To take it off the sidebar, choose Hide in its menu, or turn off "Show ${name} in the sidebar" in Settings → General.`;
}

/** Why a PATCH may not change this bot so, or null. */
export function defaultBotPatchRefusal(bot: BotRecord | null, body: Record<string, unknown>): string | null {
  for (const key of ["sidebarHidden", "welcomed"]) if (body[key] !== undefined && typeof body[key] !== "boolean") return `${key} must be true or false`;
  if ((body.sidebarHidden !== undefined || body.welcomed !== undefined) && !bot?.defaultBot) return "Only Pal is hidden this way; archive or delete other bots.";
  return body.hidden === true && bot?.defaultBot ? defaultBotRefusal(bot.name) : null;
}

/** The English intro: who MausBot is, what it does here, and that it is looking around (its follow-up comes after, from
 * helper-followup.ts). Clients that know `helperIntro` say it in the viewer's own language. */
export function helperIntroMessage(bot: Pick<BotRecord, "name" | "chiefOfStaff">): Omit<Message, "id" | "at"> {
  const title = bot.chiefOfStaff ? `Hey! I'm ${bot.name}. I'm new here.` : `Hi! I'm ${bot.name}, your helper for everything here.`;
  const subtitle = [
    bot.chiefOfStaff
      ? "I'm here to be your Chief of Staff. I can manage your other bots. Task me with anything. I'll make sure it gets to the right bot."
      : "Ask me how to do anything here. I can set up bots, apps and routines with you, and keep an eye on your day.",
    "I'm taking a look around to see if there's anything I can pick up for you. I'll follow up in a moment.",
  ].filter(Boolean).join(" ");
  return { role: "bot", kind: "options", text: `${title} ${subtitle}`, helperIntro: true, card: { title, subtitle, options: [...HELPER_ASKS], fixedOptions: true } };
}

function ledger(dataDir: string): Record<string, string> {
  const file = join(dataDir, LEDGER);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { places?: unknown };
    return parsed.places && typeof parsed.places === "object" ? parsed.places as Record<string, string> : {};
  } catch {
    return {};
  }
}

function remember(dataDir: string, botId: string): void {
  const places = ledger(dataDir);
  if (places[""] === botId) return;
  writeFileAtomic(join(dataDir, LEDGER), JSON.stringify({ v: 1, places: { ...places, "": botId } }), { mode: 0o600 });
}

/** A new install's own MausBot from before it was marked: the place's oldest bot, still live, not installed from a
 * package, and still named Pal (or MausBot, its name before the fork) or still in the colour a new install gave it. */
export function seededMausBot(bots: readonly BotRecord[]): BotRecord | undefined {
  const oldest = bots.reduce<BotRecord | undefined>((first, bot) => !first || bot.createdAt < first.createdAt ? bot : first, undefined);
  if (!oldest || oldest.hidden || oldest.installedPackage) return undefined;
  return oldest.name === DEFAULT_BOT_NAME || oldest.name === LEGACY_DEFAULT_BOT_NAME || oldest.color === STARTER_COLOR ? oldest : undefined;
}

/** Puts the intro where its person sees it next: in its open conversation while nobody has written there, else at the
 * top of a new one, so no earlier message moves. */
function introduce(store: DefaultBotStore, bot: BotRecord): void {
  const untouched = !store.messagesFor(bot.threadId).some((message) => message.role === "user");
  const threadId = untouched ? bot.threadId : store.createTask(bot.id, `What ${bot.name} can do`)?.threadId;
  if (threadId) store.appendMessage(threadId, helperIntroMessage(bot));
}

/** A new MausBot, with its intro as its first message. */
export function createDefaultBot(store: DefaultBotStore, options: { chief?: (id: string) => void } = {}): BotRecord {
  const taken = new Set(store.bots.map((bot) => bot.name.trim().toLowerCase()));
  const created = store.createBot({ name: takeImportName(DEFAULT_BOT_NAME, taken), color: DEFAULT_BOT_COLOR }, { seedMessages: false });
  options.chief?.(created.id);
  const bot = store.patchBot(created.id, { defaultBot: {} }) ?? created;
  store.appendMessage(bot.threadId, helperIntroMessage(bot));
  return bot;
}

/** Makes sure this place has had its MausBot once: the one it has, the new install's own adopted, or a new one. A
 * MausBot that is gone is never made again. Two marked ones keep the oldest. A place with no Chief of Staff at all gets
 * MausBot as its Chief, so someone keeps an eye on the day; one that has a Chief keeps it. */
export function ensureDefaultBot(store: DefaultBotStore, options: { dataDir: string }): BotRecord | null {
  const marked = store.bots.filter((bot) => bot.defaultBot).sort((a, b) => a.createdAt - b.createdAt);
  for (const extra of marked.slice(1)) store.patchBot(extra.id, { defaultBot: undefined, sidebarHidden: undefined });
  if (marked[0]) {
    remember(options.dataDir, marked[0].id);
    return marked[0];
  }
  if (Object.hasOwn(ledger(options.dataDir), "")) return null;
  const adoptable = seededMausBot(store.bots);
  const chief = !store.bots.some((bot) => bot.chiefOfStaff && !bot.hidden) ? (id: string) => store.setChiefOfStaff(id) : undefined;
  let bot: BotRecord;
  if (adoptable) {
    bot = store.patchBot(adoptable.id, { defaultBot: {}, ...(adoptable.color === STARTER_COLOR ? { color: DEFAULT_BOT_COLOR } : {}) }) ?? adoptable;
    chief?.(bot.id);
    introduce(store, bot);
  } else {
    bot = createDefaultBot(store, { chief });
  }
  remember(options.dataDir, bot.id);
  return bot;
}
