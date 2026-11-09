import { CircleAlert } from "lucide-react";
import type { Dispatch } from "react";
import type { Action, Bot, Task } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isArchived, orderedThreadList } from "./SidebarThreadRow";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { localizedTaskTitle } from "@/lib/task-title";

export function sidebarBotActivityTasks(bot: Bot, queued: Record<string, unknown[]>): Array<Task & { queued: boolean }> {
  const tasks = bot.tasks ?? [{
    threadId: bot.threadId, title: t("task.newShort"), createdAt: 0,
    busy: bot.busy, activity: bot.activity, unread: bot.unread,
    waitingForTeammates: bot.waitingForTeammates,
  }];
  return tasks.map((task) => ({ ...task, queued: Boolean(queued[task.threadId]?.length) }))
    .filter((task) => !task.routineRunId)
    .filter((task) => !isArchived(task))
    .filter((task) => task.activity === "waiting-on-you" || task.activity === "working" || task.busy || task.waitingForTeammates === true || task.queued || task.unread);
}

export function sidebarBotStatus(bot: Bot, queued: Record<string, unknown[]>) {
  const tasks = sidebarBotActivityTasks(bot, queued);
  const waiting = bot.activity === "waiting-on-you" || tasks.some((task) => task.activity === "waiting-on-you");
  const working = !waiting && (Boolean(bot.busy) || tasks.some((task) => task.busy || task.activity === "working"));
  const teammateWait = !waiting && !working && (Boolean(bot.waitingForTeammates) || tasks.some((task) => Boolean(task.waitingForTeammates)));
  return { waiting, working, teammateWait, queued: tasks.some((task) => task.queued) };
}

/** A bot has one chat, but an approval or a question can wait in a thread of its own (a routine run, a teammate's
 * work). Each such thread gets a row under the bot: the way to its card. */
function threadsWaitingOnPerson(bot: Bot): Task[] {
  return orderedThreadList((bot.tasks ?? []).filter((task) => task.activity === "waiting-on-you"));
}

export function SidebarBotActivity({ bot, rowThreadId, density, dispatch }: { bot: Bot; rowThreadId: string; density: SidebarDensity; dispatch: Dispatch<Action> }) {
  const tasks = threadsWaitingOnPerson(bot).filter((task) => task.threadId !== rowThreadId);
  if (!tasks.length) return null;
  const iconOnly = density === "icons";
  return <div data-sidebar-bot-activity={bot.id} className={cn("mb-1 space-y-0.5", !iconOnly && "ml-6")}>
    {tasks.map((task) => {
      const title = localizedTaskTitle(task.title);
      const label = `${bot.name}: ${title} · ${t("sidebar.preview.waiting")}`;
      return <button key={task.threadId} type="button" data-sidebar-activity-row={task.threadId} aria-label={label} title={label}
        onClick={() => dispatch({ type: "switchTask", botId: bot.id, threadId: task.threadId })}
        className={cn("flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-warning outline-none hover:bg-raised/50 focus-visible:ring-1 focus-visible:ring-accent/60", iconOnly && "justify-center")}>
        <CircleAlert size={12} aria-hidden="true" className="shrink-0" />
        {!iconOnly && <><span className="min-w-0 flex-1 truncate">{title}</span><span className="shrink-0 text-xs">{t("task.waiting")}</span></>}
      </button>;
    })}
  </div>;
}
