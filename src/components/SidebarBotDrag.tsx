import { useRef, useState, type Dispatch, type DragEvent } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { BOTS_SECTION_ID } from "@/lib/sidebar-layout";
import { BOT_ROW_DRAG_TYPE, botDropPlace, planBotDrop, sameBotDrop, stepBot, type BotDrop, type BotDropPlace } from "@/lib/sidebar-bot-drop";
import type { Action, Bot } from "@/state/store";
import { saveBotOrder, useMayMoveBots } from "./bot-order";

type DropHandlers = { onDragOver: (event: DragEvent<HTMLElement>) => void; onDrop: (event: DragEvent<HTMLElement>) => void };

export type BotRowDrag = {
  row(botId: string): DropHandlers & { draggable: true; onDragStart: (event: DragEvent<HTMLElement>) => void; onDragEnd: () => void };
  step(botId: string, direction: -1 | 1): void;
};

type Arranged = { enabled: boolean; ids: string[]; bots: Bot[] };

const carries = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes(BOT_ROW_DRAG_TYPE);

export function botRowDropClass(dragging: boolean | undefined): string {
  return cn(dragging && "opacity-40");
}

export function BotDropLine({ place }: { place: BotDropPlace | null | undefined }) {
  if (!place) return null;
  return <span aria-hidden="true" className={cn("pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-accent", place === "before" ? "-top-0.5" : "-bottom-0.5")} />;
}

/** Dragging the bots' rows into another order, and Alt+Up/Down. */
export function useSidebarBotDrag({ dispatch, announce }: { dispatch: Dispatch<Action>; announce: (text: string) => void }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<BotDrop | null>(null);
  const mayMove = useMayMoveBots();
  const latest = useRef<Arranged>({ enabled: false, ids: [], bots: [] });
  const moving = useRef<{ botId: string | null; drop: BotDrop | null }>({ botId: null, drop: null });
  const controller = useRef<BotRowDrag | null>(null);
  const actions = useRef({ dispatch, announce });
  actions.current = { dispatch, announce };

  const show = (next: BotDrop | null) => {
    if (sameBotDrop(moving.current.drop, next)) return;
    moving.current.drop = next;
    setDrop(next);
  };
  const end = () => {
    moving.current = { botId: null, drop: null };
    setDragging(null);
    setDrop(null);
  };
  const apply = (botId: string, order: string[], keyboard: boolean) => {
    const { bots } = latest.current;
    saveBotOrder(actions.current.dispatch, bots, order);
    if (!keyboard) return;
    const name = bots.find((bot) => bot.id === botId)?.name ?? "";
    actions.current.announce(t("sidebar.section.moved", { name, position: order.indexOf(botId) + 1, count: order.length }));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(botId)}"]`)?.focus());
  };
  const finish = (target: BotDrop | null) => {
    const botId = moving.current.botId;
    end();
    const order = botId && target && latest.current.enabled ? planBotDrop(latest.current.ids, botId, target) : null;
    if (botId && order) apply(botId, order, false);
  };
  const rowDrop = (event: DragEvent<HTMLElement>, botId: string): BotDrop => {
    const box = event.currentTarget.getBoundingClientRect();
    return { kind: "row", botId, place: botDropPlace(event.clientY - box.top, box.height) };
  };

  controller.current ??= {
    row: (botId) => ({
      draggable: true,
      onDragStart: (event) => {
        if (!latest.current.enabled || !latest.current.ids.includes(botId)) return;
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(BOT_ROW_DRAG_TYPE, botId);
        moving.current = { botId, drop: null };
        setDragging(botId);
      },
      onDragEnd: end,
      onDragOver: (event) => {
        if (!carries(event) || !moving.current.botId) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        show(botId === moving.current.botId ? null : rowDrop(event, botId));
      },
      onDrop: (event) => {
        if (!carries(event)) return;
        event.preventDefault();
        event.stopPropagation();
        finish(botId === moving.current.botId ? null : rowDrop(event, botId));
      },
    }),
    step: (botId, direction) => {
      const order = latest.current.enabled ? stepBot(latest.current.ids, botId, direction) : null;
      if (order) apply(botId, order, true);
    },
  };

  return {
    arrange({ enabled, list, bots }: { enabled: boolean; list: Bot[]; bots: Bot[] }) {
      const movable = enabled && mayMove;
      const ids = list.map((bot) => bot.id);
      latest.current = { enabled: movable, ids, bots };
      const active = movable && dragging !== null && ids.includes(dragging) ? dragging : null;
      const shown = active ? drop : null;
      const others = ids.filter((id) => id !== active);
      // Between rows, or under the last one, the nearest row places the bot.
      const zoneDrop = (event: DragEvent<HTMLElement>): BotDrop => {
        const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-sidebar-bot-row]")]
          .filter((element) => ids.includes(element.dataset.sidebarBotRow ?? "")).map((element) => ({ botId: element.dataset.sidebarBotRow!, box: element.getBoundingClientRect() }));
        if (!rows.length) return { kind: "end" };
        const row = rows.find(({ box }) => event.clientY < box.bottom) ?? rows.at(-1)!;
        return { kind: "row", botId: row.botId, place: event.clientY < row.box.top + row.box.height / 2 ? "before" : "after" };
      };
      return {
        row: (botId: string): { botDrag?: BotRowDrag; botDrop?: BotDropPlace | null; botDragging?: boolean } => {
          if (!movable || !ids.includes(botId)) return {};
          const place = shown?.kind === "row" && shown.botId === botId ? shown.place
            : shown?.kind === "end" && botId === others.at(-1) ? "after" : null;
          return { botDrag: controller.current!, botDrop: place, botDragging: active === botId };
        },
        zone: (sectionId: string, fallback: DropHandlers): DropHandlers => ({
          onDragOver: (event) => {
            if (!carries(event)) return fallback.onDragOver(event);
            if (!moving.current.botId || sectionId !== BOTS_SECTION_ID) return show(null);
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const target = zoneDrop(event);
            show(target.kind === "row" && target.botId === moving.current.botId ? null : target);
          },
          onDrop: (event) => {
            if (!carries(event)) return fallback.onDrop(event);
            event.preventDefault();
            finish(sectionId === BOTS_SECTION_ID ? zoneDrop(event) : null);
          },
        }),
      };
    },
  };
}
