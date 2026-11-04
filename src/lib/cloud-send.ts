// What this computer's page says about the one-time move to a server of the person's own (electron/one-home.mjs), in words.
import type { OneHomeView } from "../../electron/one-home.mjs";
import { t } from "@/lib/i18n";

/** The words main threw, without Electron's "Error invoking remote method" wrapper; null when there are none. */
export function ipcErrorText(cause: unknown): string | null {
  return cause instanceof Error && cause.message ? cause.message.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/u, "") : null;
}

/** How long after the move is done the corner cards still wait. */
export const MOVE_QUIET_MS = 5 * 60_000;

/** Until when the corner cards wait for the one-time move: for good while it goes (Infinity), and MOVE_QUIET_MS after it
 * is done. */
export function moveQuietUntil(move: OneHomeView | null | undefined): number {
  if (!move) return 0;
  if (move.phase === "done") return move.at ? move.at + MOVE_QUIET_MS : 0;
  return Infinity;
}

/** The move to a server of the person's own, named by its `place`, on this computer's page: on its way, almost done,
 * waiting for that server's update, or failing for a day with Try again. Once done the window shows that server, which
 * says nothing of it here. */
export function moveLine(move: OneHomeView): { kind: "sending" | "failed"; text: string; extra: string[]; retry?: true; reason?: string; place: string } | null {
  const place = move.place;
  if (!place || move.phase === "done") return null;
  const line = (kind: "sending" | "failed", text: string, more: { retry?: true; reason?: string } = {}) => ({ kind, text, extra: [], place, ...more });
  const failing = move.failing;
  if (failing) return failing.error ? line("failed", t("cloudSend.move.failingNamed", { place, error: failing.error }), { retry: true, reason: failing.error })
    : line("failed", t("cloudSend.move.failingPlainNamed", { place }), { retry: true });
  if (move.phase === "copy" && move.updating) return line("sending", t("cloudSend.move.updatingNamed", { place }));
  if (move.phase === "finishing") return line("sending", t("cloudSend.move.finishingNamed", { place }));
  if (move.phase === "wait" && move.waitingFor !== undefined) {
    return line("sending", move.waitingFor ? t("cloudSend.move.waitingNamed", { place, name: move.waitingFor })
      : t(move.waitingWhat === "sign-in" ? "cloudSend.move.waitingSignInNamed" : "cloudSend.move.waitingAnyNamed", { place }));
  }
  const chats = move.phase === "copy" ? move.chats : undefined;
  return line("sending", chats ? t("cloudSend.move.copyChatsNamed", { place, done: chats.done, total: chats.total }) : t("cloudSend.move.copyNamed", { place }));
}
