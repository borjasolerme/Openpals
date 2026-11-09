import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, BellDot, CheckCheck, ClipboardCopy, Copy, Crown, Loader2, MoreHorizontal, Pencil, Pin, PinOff, SquarePen } from "lucide-react";
import { api, useStore, openBot, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { useHeldMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import { BotDeleteMenuItem } from "./BotMenuDelete";
import { HideDefaultBotItem } from "./DefaultBotControls";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { botUnreadThreadIds, markBotRead } from "@/lib/mark-read";
import { MENU_ITEM_SEPARATOR, MENU_SHEET, navigateMenu } from "./menu-recipe";
import { MenuItem } from "./ui/MenuItem";
import { submenuPosition } from "./SidebarPopoverMenu";
import { submenuIntent, type SubmenuIntent } from "@/lib/submenu-intent";
import { useAdvancedMode } from "@/lib/interface-mode";
import type { MenuState } from "./Sidebar";

type Flyout = "more";

export function BotContextMenu({
  menu,
  onClose,
  onArchive,
  onDelete,
  onRename,
}: {
  menu: MenuState | null;
  onClose: () => void;
  onArchive: (bot: Bot) => void;
  onDelete: (bot: Bot) => void;
  onRename?: (botId: string) => void;
}) {
  const motion = useHeldMenuMotion(menu);
  const simpleMenu = !useAdvancedMode();
  const moreRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const hoveredRow = useRef<Element | null>(null);
  const [flyout, setFlyout] = useState<Flyout | null>(null);
  const [moreEngaged, setMoreEngaged] = useState(false);
  const moreIntent = useRef<SubmenuIntent | null>(null);
  moreIntent.current ??= submenuIntent({
    open: (key) => setFlyout(key as Flyout),
    close: () => { setFlyout(null); setMoreEngaged(false); },
    submenuBox: () => flyoutRef.current?.getBoundingClientRect() ?? null,
  });
  const flyoutRow = (key: Flyout | null) => (key === "more" ? moreRef.current : null);
  const rowFlyout = (row: Element | null): Flyout | null => (row && row === moreRef.current ? "more" : null);
  const more = moreIntent.current;
  const shown = motion.value;
  const { state, dispatch } = useStore();
  const member = useOwnerOrAdmin() === false;
  const bot = shown ? state.bots.find((b) => b.id === shown.botId) : undefined;
  const menuRef = useRef<HTMLDivElement>(null);
  const latestMenu = useRef(menu);
  useLayoutEffect(() => { latestMenu.current = menu; }, [menu]);
  const readInFlight = useRef(false);
  const [readingBotId, setReadingBotId] = useState<string | null>(null);
  const [readError, setReadError] = useState<{ botId: string; message: string } | null>(null);
  useEffect(() => { setReadError(null); }, [menu?.botId]);
  const readAll = async (owner: Bot) => {
    if (readInFlight.current) return;
    readInFlight.current = true;
    setReadingBotId(owner.id);
    setReadError(null);
    const openedMenu = menu;
    try {
      await markBotRead(owner, api, (updated) => dispatch({ type: "botPatched", bot: updated }));
      if (latestMenu.current === openedMenu) onClose();
    } catch (error) {
      const guidance = t("sidebar.bot.markAllReadFailed");
      setReadError({ botId: owner.id, message: error instanceof Error ? `${guidance} ${error.message}` : guidance });
    } finally {
      readInFlight.current = false;
      setReadingBotId(null);
    }
  };
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !shown) return;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      element.style.top = `${Math.max(8, Math.min(shown.y, window.innerHeight - height - 8))}px`;
      element.style.left = `${Math.max(8, Math.min(shown.x, window.innerWidth - width - 8))}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
  // Kept apart from the listeners: onClose is fresh every render, and re-running this would pull focus back to the
  // first item.
  useEffect(() => {
    if (!menu) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-bot-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);
  useEffect(() => {
    moreIntent.current?.reset();
    hoveredRow.current = null;
    setFlyout(null);
    setMoreEngaged(false);
  }, [menu]);
  useEffect(() => () => moreIntent.current?.reset(), []);
  useLayoutEffect(() => {
    const sheetOut = flyoutRef.current, row = flyoutRow(flyout), sheet = menuRef.current;
    if (!sheetOut || !row || !sheet) return;
    const place = submenuPosition(sheet.getBoundingClientRect(), row.getBoundingClientRect(), { width: sheetOut.offsetWidth, height: sheetOut.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    sheetOut.style.left = `${place.left}px`;
    sheetOut.style.top = `${place.top}px`;
  });

  if (!motion.shown || !bot || !shown) return null;
  const deleting = state.deletingBots[bot.id] === true;
  const engine = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
  const canCoordinate = engine?.capabilities?.agentsMcp === true;
  const visibleBotCount = state.bots.filter((candidate) => !candidate.hidden).length;
  const archiveBlocked = Boolean(bot.chiefOfStaff) || visibleBotCount <= 1;
  const archiveHint = bot.chiefOfStaff
    ? t("sidebar.bot.archiveBlockedChief")
    : visibleBotCount <= 1
      ? t("sidebar.bot.archiveBlockedLast")
      : undefined;
  const chiefItem = () => item(
    <Crown size={16} className={bot.chiefOfStaff ? "text-accent" : "text-ink-secondary"} />,
    bot.chiefOfStaff ? t("sidebar.bot.removeChief") : t("sidebar.bot.makeChief"),
    () => dispatch({ type: "updateBot", botId: bot.id, patch: { chiefOfStaff: !bot.chiefOfStaff } }),
    member ? { disabled: true, hint: t("sidebar.bot.chiefAdminOnly") }
      : { disabled: !bot.chiefOfStaff && !canCoordinate, hint: !bot.chiefOfStaff && !canCoordinate ? t("sidebar.bot.chiefNeedsEngine") : undefined },
  );
  const openForSettings = () => {
    if (state.selectedId === bot.id) dispatch({ type: "select", id: bot.id });
    else openBot(dispatch, bot);
  };
  const item = (
    icon: React.ReactNode,
    label: string,
    onClick?: () => void,
    opts?: { danger?: boolean; disabled?: boolean; hint?: string; keepOpen?: boolean },
  ) => (
    <MenuItem
      key={label}
      disabled={opts?.disabled}
      onClick={() => {
        onClick?.();
        if (!opts?.keepOpen) onClose();
      }}
      title={opts?.hint}
      tone={opts?.danger ? "danger" : "default"}
      icon={icon}
      label={label}
    />
  );
  const divider = (key: string) => <div key={key} role="separator" className={MENU_ITEM_SEPARATOR} />;

  if (simpleMenu) {
    const showFlyout = (key: Flyout, focus: boolean) => {
      more.openNow(key);
      if (focus) requestAnimationFrame(() => flyoutRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus());
    };
    const copyId = item(<ClipboardCopy size={16} className="text-ink-secondary" />, t("sidebar.copyConversationId"), () => { void copyText(bot.threadId); });
    const flyoutButton = (key: Flyout, ref: React.RefObject<HTMLButtonElement | null>, icon: React.ReactNode, label: string) => (
      <MenuItem
        key={key}
        ref={ref}
        data-bot-menu-more=""
        aria-haspopup="menu"
        aria-expanded={flyout === key}
        onClick={(event) => (flyout === key ? more.closeNow() : showFlyout(key, event.detail === 0))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          showFlyout(key, true);
        }}
        active={flyout === key && moreEngaged}
        icon={icon}
        label={label}
        chevron
      />
    );
    const rename = onRename && item(<SquarePen size={16} className="text-ink-secondary" />, t("sidebar.bot.rename"), () => onRename(bot.id));
    const editProfile = item(<Pencil size={16} className="text-ink-secondary" />, t("sidebar.bot.simple.editProfile"), () => {
      openForSettings();
      if (!state.settingsOpen) dispatch({ type: "toggleSettings", open: true });
    });
    const readState = readingBotId === bot.id || botUnreadThreadIds(bot).length > 0
      ? item(
        readingBotId === bot.id ? <Loader2 size={16} className="animate-spin text-ink-secondary" /> : <CheckCheck size={16} className="text-ink-secondary" />,
        readingBotId === bot.id ? t("sidebar.bot.markingAllRead") : t("sidebar.bot.simple.markRead"),
        () => { void readAll(bot); },
        { disabled: readingBotId !== null, keepOpen: true },
      )
      : item(<BellDot size={16} className="text-ink-secondary" />, t("sidebar.bot.simple.markUnread"), () => dispatch({ type: "markUnread", botId: bot.id }));
    const moreItems = [
      editProfile,
      chiefItem(),
      member ? null : item(<Copy size={16} className="text-ink-secondary" />, t("sidebar.bot.duplicate"), () => dispatch({ type: "duplicateBot", botId: bot.id })),
    ];
    const moreRow = flyoutButton("more", moreRef, <MoreHorizontal size={16} className="text-ink-secondary" />, t("sidebar.bot.more"));
    const leave = bot.defaultBot ? [<HideDefaultBotItem key="hide" bot={bot} onDone={onClose} />] : member ? [] : [
      item(<Archive size={16} className="text-ink-secondary" />, t("sidebar.bot.archive"), () => onArchive(bot), { disabled: archiveBlocked, hint: archiveHint }),
      <BotDeleteMenuItem key="delete" deleting={deleting} onClick={() => { onClose(); onDelete(bot); }} />,
    ];
    return <>{createPortal(
      <div
        ref={menuRef}
        data-bot-menu
        data-sidebar
        role="menu"
        aria-label={t("sidebar.bot.actions", { name: bot.name })}
        onKeyDown={navigateMenu}
        onPointerOver={(event) => {
          const row = event.target instanceof Element ? event.target.closest('[role="menuitem"]') : null;
          if (!row || row === hoveredRow.current) return;
          const left = rowFlyout(hoveredRow.current);
          if (left) more.leaveRow(left);
          hoveredRow.current = row;
          const key = rowFlyout(row);
          more.enterRow(key ?? "row", key !== null, { x: event.clientX, y: event.clientY });
        }}
        onPointerMove={(event) => more.move({ x: event.clientX, y: event.clientY }, flyoutRow(flyout)?.contains(event.target as Node) === true)}
        onPointerLeave={() => {
          const left = rowFlyout(hoveredRow.current);
          if (left) more.leaveRow(left);
          hoveredRow.current = null;
          more.leaveMenu();
        }}
        style={{ top: shown.y, left: shown.x }}
        className={cn("fixed z-40 max-h-[calc(100dvh-16px)] w-max min-w-49.5 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain", MENU_SHEET, motion.className)} {...motion.exitProps}
      >
        {[
          item(
            bot.pinned ? <PinOff size={16} className="text-ink-secondary" /> : <Pin size={16} className="text-ink-secondary" />,
            bot.pinned ? t("sidebar.bot.unpin") : t("sidebar.bot.pin"),
            () => dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !bot.pinned } }),
          ),
          readState,
          ...(rename ? [divider("rename"), rename] : []),
          divider("copy"),
          copyId,
          moreRow,
          ...(leave.length ? [divider("leave"), ...leave] : []),
        ]}
        {readError?.botId === bot.id && <p role="alert" className="px-2 py-1.5 text-sm text-danger">{readError.message}</p>}
      </div>,
      document.body,
    )}{flyout && createPortal(
      <div
        ref={flyoutRef}
        data-bot-menu
        data-bot-menu-flyout={flyout}
        data-sidebar
        role="menu"
        aria-label={t("sidebar.bot.more")}
        onPointerEnter={() => { more.enterSubmenu(); setMoreEngaged(true); }}
        onPointerLeave={() => setMoreEngaged(false)}
        onFocus={() => setMoreEngaged(true)}
        onBlur={(event) => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setMoreEngaged(false); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            const row = flyoutRow(flyout);
            more.closeNow();
            row?.focus();
            return;
          }
          navigateMenu(event);
        }}
        style={{ top: shown.y, left: shown.x }}
        className={cn("fixed z-40 max-h-[calc(100dvh-16px)] w-max min-w-45 max-w-[calc(100vw-16px)] animate-pop-in overflow-y-auto overscroll-contain", MENU_SHEET)}
      >
        {moreItems}
      </div>,
      document.body,
    )}</>;
  }

  return <>{createPortal(
    <div
      ref={menuRef}
      data-bot-menu
      data-sidebar
      role="menu"
      aria-label={t("sidebar.bot.actions", { name: bot.name })}
      onKeyDown={navigateMenu}
      style={{ top: shown.y, left: shown.x }}
      className={cn("fixed z-40 max-h-[calc(100dvh-16px)] w-max min-w-49.5 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain", MENU_SHEET, motion.className)} {...motion.exitProps}
    >
      {[
        item(
          bot.pinned ? <PinOff size={16} className="text-ink-secondary" /> : <Pin size={16} className="text-ink-secondary" />,
          bot.pinned ? t("sidebar.bot.unpin") : t("sidebar.bot.pin"),
          () => dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !bot.pinned } }),
        ),
        chiefItem(),
        item(<BellDot size={16} className="text-ink-secondary" />, t("sidebar.bot.markUnread"), () =>
          dispatch({ type: "markUnread", botId: bot.id }),
        ),
        item(
          readingBotId === bot.id ? <Loader2 size={16} className="animate-spin text-ink-secondary" /> : <CheckCheck size={16} className="text-ink-secondary" />,
          readingBotId === bot.id ? t("sidebar.bot.markingAllRead") : t("sidebar.bot.markAllRead"),
          () => { void readAll(bot); },
          { disabled: readingBotId !== null || botUnreadThreadIds(bot).length === 0, keepOpen: true },
        ),
        divider("d1"),
        item(<Pencil size={16} className="text-ink-secondary" />, t("sidebar.bot.editProfile"), () => {
          openForSettings();
          if (!state.settingsOpen) dispatch({ type: "toggleSettings", open: true });
        }),
        !member && item(<Copy size={16} className="text-ink-secondary" />, t("sidebar.bot.duplicate"), () =>
          dispatch({ type: "duplicateBot", botId: bot.id }),
        ),
        divider("d2"),
        item(<ClipboardCopy size={16} className="text-ink-secondary" />, t("sidebar.copyConversationId"), () => {
          void copyText(bot.threadId);
        }),
        divider("d3"),
        ...(bot.defaultBot ? [<HideDefaultBotItem key="hide" bot={bot} onDone={onClose} />] : member ? [] : [
          item(<Archive size={16} className="text-ink-secondary" />, t("sidebar.bot.archive"), () => onArchive(bot), { disabled: archiveBlocked, hint: archiveHint }),
          <BotDeleteMenuItem key="delete" deleting={deleting} onClick={() => { onClose(); onDelete(bot); }} />,
        ]),
      ]}
      {readError?.botId === bot.id && <p role="alert" className="px-2 py-1.5 text-sm text-danger">{readError.message}</p>}
    </div>,
    document.body,
  )}</>;
}
