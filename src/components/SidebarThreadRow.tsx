import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, Check, Clock3, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { AppState, Task } from "@/state/store";
import { cn } from "@/lib/cn";
import { MENU_SHEET } from "./menu-recipe";
import { useHeldMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { nextRename } from "@/lib/rename";
import { isTickable, opensRowMenuFromKey } from "@/lib/bulk-select";
import { ConfirmDialog } from "./ConfirmDialog";
import { threadLinkLabel } from "../../shared/thread-link";
import { isSnoozed, orderedThreadList } from "../../shared/wire";
import { localizedTaskTitle } from "@/lib/task-title";

export { orderedThreadList };

type ThreadRowTask = Pick<Task, "threadId" | "title" | "busy" | "activity" | "unread" | "openedBy" | "closedBy" | "archivedAt" | "snoozedUntil" | "waitingForTeammates" | "link"> & {
  queued?: boolean;
  pinned?: boolean;
  createdAt?: number;
  updatedAt?: number;
  lastThreadOrderAt?: number;
};

export function formatUpdatedAt(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  return new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export function threadUpdatedLabel(at: number, now: number): string {
  if (stampClock(at, now) === undefined) return formatUpdatedAt(at);
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return t("task.updated.justNow");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("task.updated.minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (seconds < 86_400) return t("task.updated.hours", { count: hours });
  const days = Math.round(hours / 24);
  if (days === 1) return t("task.updated.yesterday");
  return t("task.updated.days", { count: days });
}

export function stampClock(at: number, now: number): number | undefined {
  if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(now)) return undefined;
  return Math.max(0, Math.round((now - at) / 1000)) < 7 * 86_400 ? now : undefined;
}

export function threadRecency(task: { updatedAt?: number; createdAt?: number }): number {
  if (typeof task.updatedAt === "number" && Number.isFinite(task.updatedAt)) return task.updatedAt;
  if (typeof task.createdAt === "number" && Number.isFinite(task.createdAt)) return task.createdAt;
  return 0;
}

export function threadOpenerLabel(task: Pick<Task, "openedBy">): string | null {
  const name = task.openedBy?.name.trim();
  return name ? t("task.openedBy", { name }) : null;
}

export function threadByline(task: Pick<Task, "openedBy" | "closedBy" | "archivedAt" | "snoozedUntil">): string | null {
  const closer = task.closedBy?.name.trim();
  if (closer) return t("task.closedBy", { name: closer });
  if (isArchived(task)) return t("task.archived");
  return isSnoozed(task) ? t("task.snoozed") : threadOpenerLabel(task);
}

/** Present, not truthy: a thread stored with archivedAt: 0 is archived. */
export const isArchived = (task: Pick<Task, "archivedAt">): boolean => task.archivedAt !== undefined;

const isWorking = (task: Pick<Task, "activity" | "busy">): boolean => task.activity === "working" || Boolean(task.busy);

const isWaitingOnTeammate = (task: Pick<Task, "waitingForTeammates">): boolean =>
  task.waitingForTeammates === true;

const demandsAttention = (task: ThreadRowTask, activeId: string) =>
  task.threadId === activeId || task.activity === "waiting-on-you" || isWorking(task) || isWaitingOnTeammate(task) || Boolean(task.queued) || Boolean(task.unread);

export function visibleSidebarThreads<T extends ThreadRowTask>(tasks: T[], activeId: string, query = "", showAll = false): T[] {
  const needle = query.trim().toLowerCase();
  if (needle) return tasks.filter((task) => task.title.toLowerCase().includes(needle));
  if (showAll) return tasks;
  let open = 0;
  return orderedThreadList(tasks).filter((task) => {
    if (task.pinned === true) return true;
    if (isArchived(task)) return task.threadId === activeId;
    return task.closedBy || isSnoozed(task)
      ? demandsAttention(task, activeId)
      : open++ < 6 || demandsAttention(task, activeId);
  });
}

export function useRevealedThreadRow(reveal: AppState["revealThread"], currentThreadId: string | null) {
  useEffect(() => {
    if (!reveal || reveal.threadId !== currentThreadId) return;
    const row = document.querySelector<HTMLElement>(`[data-sidebar-thread-row="${CSS.escape(reveal.threadId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [reveal, currentThreadId]);
}

export function useRelativeNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    const timer = window.setInterval(sync, 30_000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return now;
}
type ThreadRowProps = {
  task: ThreadRowTask;
  current: boolean;
  now?: number;
  locale: string;
  onSelect: (task: ThreadRowTask) => void;
  onRename: (task: ThreadRowTask, title: string) => void;
  onDelete: (task: ThreadRowTask) => void;
  onArchive: (task: ThreadRowTask, archivedAt: number | null) => void;
  onPin: (task: ThreadRowTask, pinned: boolean) => void;
  selectMode?: boolean;
  checked?: boolean;
  onToggleSelect?: (task: ThreadRowTask, shiftKey: boolean) => void;
};

const sameFields = <T extends object>(a: T, b: T): boolean => {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
};

const sameThreadRow = ({ task: previousTask, ...previous }: ThreadRowProps, { task, ...next }: ThreadRowProps): boolean =>
  sameFields(previousTask, task) && sameFields(previous, next);

export const SidebarThreadRow = memo(function SidebarThreadRow({ task, current, onSelect, onRename, onDelete, onArchive, onPin, now, selectMode = false, checked = false, onToggleSelect }: ThreadRowProps) {
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const menuMotion = useHeldMenuMotion(menu);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [deleting, setDeleting] = useState(false);
  const displayTitle = localizedTaskTitle(task.title);
  const finishing = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const status = task.activity === "waiting-on-you" ? t("task.waiting") : isWaitingOnTeammate(task) ? t("task.waitingOnTeammate") : isWorking(task) ? t("chat.activity.working") : task.queued ? t("task.queued") : null;
  const byline = threadByline(task);
  const updatedAt = threadRecency(task);
  const updatedStamp = formatUpdatedAt(updatedAt);
  const updatedLabel = now === undefined ? updatedStamp : threadUpdatedLabel(updatedAt, now);
  const closed = Boolean(task.closedBy) && !status;
  const archived = isArchived(task);
  const snoozed = isSnoozed(task);
  const tickable = isTickable(task);
  const choose = (event: React.MouseEvent) => { if (!selectMode) onSelect(task); else if (tickable) onToggleSelect?.(task, event.shiftKey); };
  const contextMenu = (event: React.MouseEvent) => { event.preventDefault(); if (!selectMode) openMenu(event.clientX, event.clientY); };
  const openMenu = (x: number, y: number) => setMenu({ left: Math.max(8, Math.min(x, window.innerWidth - 228)), top: Math.max(8, Math.min(y, window.innerHeight - 230)) });
  const startRename = () => { finishing.current = false; setDraft(task.title); setRenaming(true); setMenu(null); };
  const finishRename = (save: boolean) => {
    if (finishing.current) return;
    finishing.current = true;
    const title = save ? nextRename(task.title, draft) : null;
    setRenaming(false);
    if (title) onRename(task, title);
  };
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !actionRef.current?.contains(event.target)) setMenu(null);
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [menu]);
  useEffect(() => {
    if (!menu || !menuRef.current) return;
    const keepOnScreen = () => {
      const el = menuRef.current;
      if (!el) return;
      const top = Math.max(8, window.innerHeight - el.offsetHeight - 8);
      setMenu((current) => (current && current.top > top ? { ...current, top } : current));
    };
    keepOnScreen();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(keepOnScreen);
    observer?.observe(menuRef.current);
    window.addEventListener("resize", keepOnScreen);
    return () => { observer?.disconnect(); window.removeEventListener("resize", keepOnScreen); };
  }, [menu]);
  const heading = <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
    <span dir="auto" className={cn("min-w-0 flex-1 max-w-max truncate", task.unread && "font-semibold text-ink", (closed || archived || snoozed) && !current && "text-ink-tertiary")}>{displayTitle}</span>
    {byline && (
      <span className="min-w-0 max-w-[45%] shrink truncate font-normal text-ink-tertiary">{byline}</span>
    )}
  </span>;
  return <>
    <div className={cn("group/thread relative flex min-w-0 items-center rounded-md", selectMode && checked ? "bg-accent/10" : current ? "bg-raised" : "hover:bg-raised/50")}>
      {renaming ? <input autoFocus value={draft} maxLength={80} aria-label={t("task.renameAria")}
        onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(event.target.value)} onBlur={() => finishRename(true)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); finishRename(true); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishRename(false); } }}
        dir="auto" className="m-1 min-w-0 flex-1 rounded border border-accent/50 bg-inset px-2 py-1 text-[13px] text-ink outline-none" /> : <button
        type="button" data-sidebar-thread-row={task.threadId} aria-current={current ? "page" : undefined}
        title={[displayTitle, updatedStamp, status, closed ? t("task.closed") : null, archived ? t("task.archived") : null, snoozed ? t("task.snoozed") : null, task.unread ? t("task.unread") : null].filter(Boolean).join(" · ")}
        {...(selectMode ? { role: "checkbox", "aria-checked": checked, "aria-disabled": !tickable, "aria-label": t("task.bulk.rowCheck", { title: displayTitle }) } : {})}
        onClick={choose} onDoubleClick={selectMode ? undefined : startRename} onContextMenu={contextMenu}
        onKeyDown={(event) => { if (opensRowMenuFromKey(event.key, event.shiftKey, selectMode)) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openMenu(rect.left, rect.bottom); } }}
        className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-md pl-6 pr-1 text-left text-[13px] font-medium outline-none focus-visible:ring-1 focus-visible:ring-accent/60", "min-h-8 py-1.5", current ? "font-semibold text-ink" : "text-ink-secondary hover:text-ink", selectMode && "pl-1.5", selectMode && !tickable && "cursor-not-allowed opacity-60")}>
        {selectMode && <span aria-hidden="true" title={tickable ? undefined : t("task.bulk.running")}
          className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border", checked ? "border-accent bg-accent text-white" : "border-ink-tertiary", !tickable && "opacity-50")}>
          {checked && <Check size={10} strokeWidth={3} />}
        </span>}
        {heading}
      </button>}
      {task.link && <a href={task.link} target="_blank" rel="noreferrer" dir="ltr" title={task.link} aria-label={t("task.openLink", { link: threadLinkLabel(task.link) ?? task.link })}
        className="shrink-0 rounded px-1 font-mono text-[11px] text-ink-secondary hover:bg-raised hover:text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent/60 [unicode-bidi:isolate]">{threadLinkLabel(task.link) ?? t("task.link")}</a>}
      {!renaming && <span className="flex shrink-0 items-center gap-2 px-1" onClick={choose} onContextMenu={contextMenu}>
        {updatedLabel && <time dateTime={new Date(updatedAt).toISOString()} className="shrink-0 tabular-nums text-[10px] text-ink-secondary">{updatedLabel}</time>}
        {task.pinned === true && <Pin size={11} className="shrink-0 text-ink-secondary" aria-label={t("sidebar.bot.pin")} />}
        {task.activity === "waiting-on-you" ? <span className="shrink-0 text-[10px] font-medium text-warning">{t("task.waiting")}</span> : isWaitingOnTeammate(task) ? <Clock3 size={11} className="shrink-0 text-ink-secondary" aria-label={t("task.waitingOnTeammate")} /> : isWorking(task) ? <Loader2 size={11} className="shrink-0 animate-spin text-success" aria-label={t("chat.activity.working")} /> : task.queued ? <span className="shrink-0 text-[10px] text-ink-secondary">{t("task.queued")}</span> : null}
        {task.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label={t("task.unread")} />}
      </span>}
      {!selectMode && <button ref={actionRef} type="button" aria-label={t("task.actions", { title: displayTitle })} aria-expanded={Boolean(menu)}
        onClick={(event) => { if (menu) { setMenu(null); return; } const rect = event.currentTarget.getBoundingClientRect(); openMenu(rect.left, rect.bottom); }}
        className={cn("mr-0.5 flex size-6 shrink-0 items-center justify-center rounded text-ink-secondary opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover/thread:opacity-100 max-md:opacity-70 touch:opacity-70")}>
        <MoreHorizontal size={13} />
      </button>}
    </div>
    {menuMotion.shown && menuMotion.value && createPortal(<div ref={menuRef} data-thread-overlay role="group" aria-label={t("task.actions", { title: displayTitle })} style={menuMotion.value}
      className={cn("fixed z-50 max-h-[calc(100vh-16px)] w-[220px] overflow-y-auto", MENU_SHEET, menuMotion.className)} {...menuMotion.exitProps}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMenu(null); actionRef.current?.focus(); } }}>
      <button type="button" onClick={startRename} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] leading-[18px] text-ink hover:bg-menu-hover"><Pencil size={16} />{t("task.renameAria")}</button>
      <button type="button" onClick={() => { setMenu(null); onPin(task, task.pinned !== true); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] leading-[18px] text-ink hover:bg-menu-hover">{task.pinned === true ? <PinOff size={16} /> : <Pin size={16} />}{task.pinned === true ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}</button>
      <button type="button" disabled={isWorking(task)} onClick={() => { setMenu(null); onArchive(task, isArchived(task) ? null : Date.now()); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] leading-[18px] text-ink hover:bg-menu-hover disabled:opacity-40">{archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{archived ? t("task.unarchive") : t("task.archive")}</button>
      <button type="button" disabled={isWorking(task)} onClick={() => { setMenu(null); setDeleting(true); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] leading-[18px] text-danger hover:bg-menu-hover disabled:opacity-40"><Trash2 size={16} />{t("task.deleteAria")}</button>
    </div>, document.body)}
    <ConfirmDialog open={deleting} title={t("task.deleteConfirm")} body={t("task.deleteBody", { title: task.title })} confirmLabel={t("task.deleteAria")}
      onCancel={() => setDeleting(false)} onConfirm={() => { if (!isWorking(task)) onDelete(task); setDeleting(false); }} returnFocusRef={actionRef} />
  </>;
}, sameThreadRow);
