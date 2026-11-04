import type { Bot, BotAnnouncement } from "@/state/store";

type ReadableBot = Pick<Bot, "id" | "threadId" | "unread" | "tasks">;

export function botUnreadThreadIds(bot: ReadableBot): string[] {
  if (!bot.tasks?.length) return bot.unread ? [bot.threadId] : [];
  return bot.tasks
    .filter((task) => task.unread ?? (task.threadId === bot.threadId && bot.unread))
    .map((task) => task.threadId);
}

export async function markBotRead(
  bot: ReadableBot,
  request: (path: string, init?: RequestInit) => Promise<{ bot: BotAnnouncement }>,
  onRead: (bot: BotAnnouncement) => void,
): Promise<void> {
  await markThreadsRead(bot.id, botUnreadThreadIds(bot), request, onRead);
}

async function markThreadsRead(
  botId: string,
  threadIds: readonly string[],
  request: (path: string, init?: RequestInit) => Promise<{ bot: BotAnnouncement }>,
  onRead: (bot: BotAnnouncement) => void,
): Promise<void> {
  for (const threadId of threadIds) {
    const result = await request(`/api/bots/${botId}/read`, {
      method: "POST",
      body: JSON.stringify({ threadId }),
    });
    onRead(result.bot);
  }
}
