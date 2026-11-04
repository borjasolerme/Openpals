import { useEffect, useState } from "react";
import { parseChatLink } from "@/lib/chat-links";
import { openBot, openThread, type Action, type AppState } from "@/state/store";

/** Security: a link from outside the app only navigates. A bot's link opens its chat; a room's opens the room. */
export function openChatLink(dispatch: (action: Action) => void, link: string, state: AppState): boolean {
  const address = parseChatLink(link);
  const threadId = address?.threadId;
  const holds = (owner: { threadId: string; tasks?: ReadonlyArray<{ threadId: string }> }) =>
    threadId !== undefined && (owner.threadId === threadId || (owner.tasks ?? []).some((task) => task.threadId === threadId));
  const bot = address?.botId ? state.bots.find((candidate) => candidate.id === address.botId) : state.bots.find(holds);
  if (bot) {
    openBot(dispatch, bot);
    return true;
  }
  const room = state.groups.find((group) => !group.dm && (address?.botId ? group.id === address.botId : holds(group)));
  if (room) {
    if (threadId && holds(room)) openThread(dispatch, { botId: room.id, threadId }, state);
    else dispatch({ type: "select", id: room.id });
    return true;
  }
  if (state.activeView !== "chat" && state.selectedId) dispatch({ type: "select", id: state.selectedId });
  dispatch({ type: "notice", notice: { kind: address && !threadId ? "bot-gone" : "thread-gone", botName: null } });
  return false;
}

export function useExternalChatLinks(state: AppState, dispatch: (action: Action) => void): void {
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => window.ogb?.onChatLink?.(setLink), []);
  useEffect(() => {
    if (!link || !state.hydrated) return;
    setLink(null);
    if (state.appSettingsOpen) dispatch({ type: "toggleAppSettings", open: false });
    if (state.shortcutsOpen) dispatch({ type: "toggleShortcuts", open: false });
    openChatLink(dispatch, link, state);
  }, [link, state, dispatch]);
}
