import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  sidebarAttentionLabel,
  type SidebarSectionAttention,
} from "@/lib/sidebar-attention";

export function SidebarSectionHeader({
  name,
  collapsed,
  attention,
  alert,
  onToggle,
  reorderable: canReorder,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  line = false,
  count,
}: {
  name: string;
  collapsed: boolean;
  attention?: SidebarSectionAttention;
  alert?: boolean;
  onToggle?: () => void;
  reorderable: boolean;
  dragging: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onMove?: (direction: -1 | 1) => void;
  line?: boolean;
  /** How many rows the section holds, shown at rest where the chevron shows on hover (Simple). */
  count?: number;
}) {
  const reorderable = canReorder;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const attentionLabel = attention ? sidebarAttentionLabel(attention) : "";
  const onHeaderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!reorderable || !event.altKey) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMove?.(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onMove?.(1);
    }
  };
  const toggleTitle = reorderable
    ? collapsed
      ? t("sidebar.section.expandReorder", { name })
      : t("sidebar.section.collapseReorder", { name })
    : collapsed
      ? t("sidebar.section.expand", { name })
      : t("sidebar.section.collapse", { name });

  if (line) {
    const tail = (
      <span aria-hidden="true" className="relative flex size-4 shrink-0 items-center justify-center">
        {count !== undefined && <span className={cn("text-sm tabular-nums text-ink-secondary transition-opacity", onToggle && "group-hover/section:opacity-0 group-focus-within/section:opacity-0 touch:opacity-0")}>{count}</span>}
        {onToggle && <Chevron size={14} className="absolute text-ink-secondary opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100 touch:opacity-100" />}
      </span>
    );
    return (
      <div
        data-section={name}
        data-sidebar-section-line=""
        draggable={reorderable || undefined}
        onDragStart={reorderable ? onDragStart : undefined}
        onDragEnd={reorderable ? onDragEnd : undefined}
        className={cn("group/section flex h-7.5 items-center gap-1.5 rounded-md px-2 pb-1.5 pt-2 hover:bg-raised/50", reorderable && "cursor-grab", dragging && "opacity-40")}
      >
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            onKeyDown={onHeaderKeyDown}
            aria-expanded={!collapsed}
            aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
            title={toggleTitle}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-ink-secondary">{name}</span>
            {collapsed && <SectionAttention attention={attention} label={attentionLabel} alert={alert} />}
            {tail}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-ink-secondary">{name}</span>
            {attentionLabel && <span className="sr-only">{attentionLabel}</span>}
            {tail}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-md px-2 pb-1" data-section={name}>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          onKeyDown={onHeaderKeyDown}
          aria-expanded={!collapsed}
          aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          title={toggleTitle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-raised/50"
        >
          <span className="truncate text-sm font-semibold text-ink-secondary">
            {name}
          </span>
          <Chevron size={13} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <SectionAttention attention={attention} label={attentionLabel} alert={alert} />
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5">
          <span className="truncate text-sm font-semibold text-ink-secondary">
            {name}
          </span>
          {attentionLabel && <span className="sr-only">{attentionLabel}</span>}
        </div>
      )}
      {reorderable && (
        <span
          aria-hidden="true"
          draggable
          title={t("sidebar.section.dragToReorder")}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className={cn(
            "flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink",
            dragging && "opacity-40",
          )}
        >
          <GripVertical size={13} />
        </span>
      )}
    </div>
  );
}

function SectionAttention({ attention, label, alert }: { attention?: SidebarSectionAttention; label: string; alert?: boolean }) {
  return (
    <>
      {attention && attention.waiting > 0 && (
        <span
          aria-hidden="true"
          className="min-w-4 rounded-full bg-warning/15 px-1 text-center text-xs font-semibold leading-4 text-warning"
        >
          {attention.waiting}
        </span>
      )}
      {attention && attention.unread > 0 && (
        <span
          aria-hidden="true"
          className="min-w-4 rounded-full bg-accent/15 px-1 text-center text-xs font-semibold leading-4 text-accent"
        >
          {attention.unread}
        </span>
      )}
      {attention && attention.working > 0 && (
        <span
          aria-hidden="true"
          className="flex size-4 items-center justify-center"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
        </span>
      )}
      {label && <span className="sr-only">{label}</span>}
      {alert && (
        <>
          <span data-testid="section-alert" aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
          <span className="sr-only">{t("computer.routines.needsYou")}</span>
        </>
      )}
    </>
  );
}
