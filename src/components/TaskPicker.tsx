import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Pin, PinOff, Search, SquarePen, Trash2 } from "lucide-react";
import { useStore, type Group, type Task } from "@/state/store";
import { cn } from "@/lib/cn";
import { MENU_ITEM_SEPARATOR, MENU_SHEET } from "./menu-recipe";
import { roomThreadsWorkingElsewhere } from "@/lib/room-threads";
import { useMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { localizedTaskTitle } from "@/lib/task-title";
import { COMPACT_BUBBLE } from "@/lib/compact-chip";
import { formatTaskTokens, headlineTokens, usageDetail } from "@/lib/usage";
import { nextRename } from "@/lib/rename";
import { formatUpdatedAt, orderedThreadList, threadByline, threadRecency, threadUpdatedLabel, useRelativeNow } from "./SidebarThreadRow";

export const TASK_PICKER_DISMISS_MS = 500;


/** The click that accompanies a dblclick has detail >= 2 and must not switch or close. */
export function taskPickerPointerIntent(
  type: string,
  detail = 1,
): "select" | "rename" | "ignore" {
  if (type === "dblclick" || type === "contextmenu") return "rename";
  if (type === "click" && detail >= 2) return "ignore";
  if (type === "click") return "select";
  return "ignore";
}

export function filterTasks<T extends { title: string }>(tasks: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...tasks];
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const task of tasks) {
    const title = task.title.toLowerCase();
    if (title.startsWith(needle)) prefix.push(task);
    else if (title.includes(needle)) substring.push(task);
  }
  return [...prefix, ...substring];
}

function TaskUpdatedTime({ task, now }: { task: { updatedAt?: number; createdAt?: number }; now: number }) {
  const stamp = threadRecency(task);
  if (!Number.isFinite(stamp) || stamp <= 0) return null;
  return <time dateTime={new Date(stamp).toISOString()} title={formatUpdatedAt(stamp)}>{threadUpdatedLabel(stamp, now)}</time>;
}

function TaskUsage({ usage }: { usage: Task["usage"] }) {
  if (!usage) return null;
  const label = formatTaskTokens(headlineTokens(usage));
  if (!label) return null;
  return (
    <span
      title={usageDetail(usage)}
    >
      {" · "}
      {label}
    </span>
  );
}

type PickerTask = Pick<Task, "threadId" | "title" | "createdAt" | "updatedAt" | "pinned" | "busy" | "activity" | "unread" | "openedBy" | "closedBy" | "archivedAt" | "snoozedUntil" | "waitingForTeammates"> & { usage?: Task["usage"] };

function ConversationTaskPicker({
  threadId,
  tasks,
  busy,
  onNew,
  onSwitch,
  onRename,
  onDelete,
  onPin,
  workingElsewhere = 0,
}: {
  threadId: string;
  tasks: PickerTask[];
  busy: boolean;
  workingElsewhere?: number;
  onNew: () => void;
  onSwitch: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onDelete: (threadId: string) => void;
  onPin?: (threadId: string, pinned: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishingRename = useRef(false);
  const now = useRelativeNow();

  const current = tasks.find((t) => t.threadId === threadId);

  const clearDismiss = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  };

  const closeMenu = () => {
    clearDismiss();
    setRenaming(null);
    setQuery("");
    setOpen(false);
  };

  const queueDismiss = () => {
    clearDismiss();
    dismissTimer.current = setTimeout(() => {
      dismissTimer.current = null;
      setRenaming(null);
      setOpen(false);
    }, TASK_PICKER_DISMISS_MS);
  };

  const startRename = (task: PickerTask) => {
    clearDismiss();
    finishingRename.current = false;
    setDraft(task.title);
    setRenaming(task.threadId);
  };

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  useEffect(() => {
    if (!open) {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setRenaming(null);
      setQuery("");
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-thread-overlay]")) return;
      // SAFETY: a mousedown target inside a document is always a DOM Node
      if (!ref.current?.contains(e.target as Node)) {
        if (dismissTimer.current) {
          clearTimeout(dismissTimer.current);
          dismissTimer.current = null;
        }
        setRenaming(null);
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.target instanceof Element && e.target.closest("[data-thread-overlay]")) return;
      if (renaming) return;
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setRenaming(null);
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, renaming]);

  const commitRename = (threadId: string, save: boolean) => {
    // Escape unmounts the input, which fires blur; without this guard blur would save the cancelled draft.
    if (finishingRename.current) return;
    finishingRename.current = true;
    const currentTitle = tasks.find((task) => task.threadId === threadId)?.title ?? "";
    const title = save ? nextRename(currentTitle, draft) : null;
    setRenaming(null);
    if (title) onRename(threadId, title);
  };

  const u = current?.usage;
  const currentLabel = u ? formatTaskTokens(headlineTokens(u)) : null;
  const switchTitle =
    u && currentLabel
      ? t("task.switchWithUsageDetail", {
          label: currentLabel,
          detail: usageDetail(u),
        })
      : t("task.switch");
  const visible = filterTasks(tasks, query);
  const looking = query.trim();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (open) closeMenu();
          else setOpen(true);
        }}
        title={switchTitle}
        aria-label={t("task.switch")}
        className={cn(
          "flex max-w-[220px] items-center gap-1.5 rounded-full border border-hairline/40 px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink",
          COMPACT_BUBBLE,
        )}
      >
        <span className="truncate @max-4xl/chathead:hidden">{t("task.switch")}</span>
        <span className="shrink-0 tabular-nums opacity-60 @max-4xl/chathead:opacity-100">{tasks.length}</span>
        {workingElsewhere > 0 && (
          <span
            role="img"
            data-working-elsewhere={workingElsewhere}
            aria-label={t("task.workingElsewhere", { count: workingElsewhere })}
            title={t("task.workingElsewhere", { count: workingElsewhere })}
            className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"
          />
        )}
        <ChevronDown size={12} className="shrink-0 @max-4xl/chathead:hidden" />
      </button>

      {motion.shown && (
        <div className={cn("absolute right-0 top-full z-40 mt-1 w-[300px] overflow-hidden", MENU_SHEET, motion.className)} {...motion.exitProps}>
          <div>
            <div className="flex items-center gap-2 rounded-md bg-ink/[0.05] px-2 py-1.5 focus-within:ring-2 focus-within:ring-focus/60">
              <Search size={14} className="shrink-0 text-ink-secondary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (looking) setQuery("");
                    else closeMenu();
                    return;
                  }
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const first = visible[0];
                    if (!first) return;
                    if (first.threadId !== threadId) onSwitch(first.threadId);
                    closeMenu();
                  }
                }}
                placeholder={t("task.search")}
                aria-label={t("task.search")}
                className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto" role="group" aria-label={looking ? t("task.matching", { count: visible.length }) : t("task.list")}>
            {visible.length === 0 ? (
              <div className="px-2 py-6 text-center text-[13px] text-ink-secondary">
                {t("task.noMatch", { query: looking })}
              </div>
            ) : visible.map((task) => {
              const active = task.threadId === threadId;
              const opener = threadByline(task);
              return (
                <div
                  key={task.threadId}
                  className={cn("group flex items-center gap-2 rounded-md px-2 py-1.5", active ? "bg-menu-active" : "hover:bg-menu-hover")}
                >
                  <Check size={14} className={cn("shrink-0", active ? "text-accent" : "opacity-0")} />
                  {renaming === task.threadId ? (
                    <input
                      autoFocus
                      value={draft}
                      maxLength={80}
                      aria-label={t("task.renameAria")}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onBlur={() => commitRename(task.threadId, true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          e.stopPropagation();
                          commitRename(task.threadId, true);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          commitRename(task.threadId, false);
                        }
                      }}
                      className="min-w-0 flex-1 rounded bg-inset px-1.5 py-0.5 text-[13px] text-ink focus:outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        if (taskPickerPointerIntent("click", e.detail) !== "select") return;
                        if (!active) onSwitch(task.threadId);
                        queueDismiss();
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(task);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(task);
                      }}
                      className="min-w-0 flex-1 text-left"
                      title={t("task.renameHint")}
                    >
                      <div dir="auto" className="truncate text-[14px] leading-[18px] text-ink">{localizedTaskTitle(task.title)}</div>
                      <div className="text-[11px] text-ink-secondary">
                        {task.activity === "waiting-on-you" ? `${t("task.waiting")} · ` : task.waitingForTeammates ? `${t("task.waitingOnTeammate")} · ` : task.busy ? `${t("chat.activity.working")} · ` : task.unread ? `${t("task.unread")} · ` : ""}
                        <TaskUpdatedTime task={task} now={now} />
                        <TaskUsage usage={task.usage} />
                        {opener && ` · ${opener}`}
                      </div>
                    </button>
                  )}
                  {onPin && renaming !== task.threadId && (
                    <button
                      type="button"
                      onClick={() => onPin(task.threadId, task.pinned !== true)}
                      aria-label={task.pinned === true ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}
                      title={task.pinned === true ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}
                      className="rounded-md p-1 text-ink-secondary opacity-0 hover:bg-menu-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-70"
                    >
                      {task.pinned === true ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                  )}
                  {renaming !== task.threadId && (
                    <button
                      type="button"
                      onClick={() => startRename(task)}
                      aria-label={t("task.renameNamed", { title: task.title })}
                      title={t("task.renameTitle")}
                      className="rounded-md p-1 text-ink-secondary opacity-0 hover:bg-menu-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-70"
                    >
                      <SquarePen size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(task.threadId)}
                    disabled={Boolean(task.busy) || busy && active}
                    aria-label={t("task.deleteAria")}
                    title={t("task.deleteTitle")}
                    className="rounded-md p-1 text-ink-secondary opacity-0 hover:bg-menu-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-20 touch:opacity-70 touch:disabled:opacity-20"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <div role="separator" className={MENU_ITEM_SEPARATOR} />
          <button
            type="button"
            onClick={() => {
              onNew();
              closeMenu();
            }}
            disabled={busy}
            className="flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] text-ink hover:bg-menu-hover disabled:opacity-40"
          >
            <SquarePen size={16} className="text-ink-secondary" /> {t("task.newShort")}
          </button>
        </div>
      )}
    </div>
  );
}

export function GroupTaskPicker({ group }: { group: Group }) {
  const { dispatch } = useStore();
  const tasks = useMemo(() => {
    return (group.tasks ?? []).map((task) => ({
      ...task,
      busy: Boolean(task.working || task.busyBotId),
    }));
  }, [group.tasks]);
  return (
    <ConversationTaskPicker
      threadId={group.threadId}
      tasks={orderedThreadList(tasks)}
      busy={false}
      workingElsewhere={roomThreadsWorkingElsewhere(group)}
      onNew={() => dispatch({ type: "newGroupTask", groupId: group.id })}
      onSwitch={(threadId) => dispatch({ type: "switchGroupTask", groupId: group.id, threadId })}
      onRename={(threadId, title) => dispatch({ type: "renameGroupTask", groupId: group.id, threadId, title })}
      onDelete={(threadId) => dispatch({ type: "deleteGroupTask", groupId: group.id, threadId })}
      onPin={(threadId, pinned) => {
        const title = group.tasks?.find((task) => task.threadId === threadId)?.title ?? "";
        dispatch({ type: "pinGroupTask", groupId: group.id, threadId, pinned, title });
      }}
    />
  );
}
