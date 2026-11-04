import type { Dispatch } from "react";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { api, type Action, type Bot } from "@/state/store";

const failure = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Whether this person may move bots to another place in the list, from a menu or by dragging. */
export function useMayMoveBots(): boolean {
  return useOwnerOrAdmin() !== false;
}

/** Shows `botIds` in this order at once and saves it; every other bot keeps its place in the fleet. */
export function saveBotOrder(dispatch: Dispatch<Action>, bots: readonly Pick<Bot, "id">[], botIds: string[]): void {
  const before = bots.filter((bot) => botIds.includes(bot.id)).map((bot) => bot.id);
  if (before.length === botIds.length && before.every((id, index) => id === botIds[index])) return;
  dispatch({ type: "botsOrdered", botIds });
  void api("/api/bots/order", { method: "PUT", body: JSON.stringify({ botIds }) }).catch((cause) => {
    dispatch({ type: "botsOrdered", botIds: before });
    dispatch({ type: "error", message: failure(cause) });
  });
}
