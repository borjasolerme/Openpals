type UnreadBot = {
  unread?: boolean;
  threadId?: string;
  mainThreadId?: string;
  tasks?: ReadonlyArray<{ threadId?: string; unread?: boolean }> | null;
};

/** One chat per bot: only its main chat can be read, so only it lights the dot. Work the bot does in a background
 * conversation (a routine run, a request from another bot) reaches the person through that chat, never on its own. */
export function botShowsUnread(bot: UnreadBot): boolean {
  const main = bot.mainThreadId ?? bot.threadId;
  const chat = main ? bot.tasks?.find((task) => task.threadId === main) : undefined;
  return chat ? Boolean(chat.unread) : Boolean(bot.unread);
}


const SHOWN_COUNT = /^\(\d+\) /;

/** Puts the count in front of the page's own title, in place of a count shown before. */
export function titleWithUnread(title: string, count: number): string {
  const own = title.replace(SHOWN_COUNT, "");
  return count > 0 ? `(${count}) ${own}` : own;
}

export function showBrowserUnread(count: number): void {
  document.title = titleWithUnread(document.title, count);
  // Chromium and Safari badge an installed web app's icon from this; other browsers lack the API.
  const badge = count > 0 ? navigator.setAppBadge?.(count) : navigator.clearAppBadge?.();
  void badge?.catch(() => {});
}
