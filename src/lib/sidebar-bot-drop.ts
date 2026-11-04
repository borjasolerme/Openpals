export const BOT_ROW_DRAG_TYPE = "application/x-openmausbot-sidebar-bot";

/** Where a dragged bot lands against the row under the pointer: above it or below it. */
export type BotDropPlace = "before" | "after";

export type BotDrop =
  | { kind: "row"; botId: string; place: BotDropPlace }
  /** Under the last row. */
  | { kind: "end" };

export function botDropPlace(offset: number, height: number): BotDropPlace {
  const fraction = height > 0 ? offset / height : 0.5;
  return fraction < 0.5 ? "before" : "after";
}

export function sameBotDrop(a: BotDrop | null, b: BotDrop | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "row") return b.kind === "row" && a.botId === b.botId && a.place === b.place;
  return b.kind === "end";
}

function placed(ids: readonly string[], botId: string, at: (others: string[]) => number): string[] | null {
  const order = ids.filter((id) => id !== botId);
  order.splice(at(order), 0, botId);
  return order.every((id, index) => id === ids[index]) ? null : order;
}

/** The list's order once `botId` is dropped there, or null when the drop changes nothing. */
export function planBotDrop(ids: readonly string[], botId: string, drop: BotDrop): string[] | null {
  if (!ids.includes(botId)) return null;
  if (drop.kind === "end") return placed(ids, botId, (others) => others.length);
  if (drop.botId === botId || !ids.includes(drop.botId)) return null;
  return placed(ids, botId, (others) => others.indexOf(drop.botId) + (drop.place === "after" ? 1 : 0));
}

export function stepBot(ids: readonly string[], botId: string, direction: -1 | 1): string[] | null {
  const index = ids.indexOf(botId);
  if (index < 0 || index + direction < 0 || index + direction >= ids.length) return null;
  return placed(ids, botId, () => index + direction);
}

export function stepKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): -1 | 1 | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  return event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : null;
}
