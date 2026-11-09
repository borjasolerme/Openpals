import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch } from "react";
import { createPortal } from "react-dom";
import { Archive, Bot as BotIcon, Check, ChevronRight, ClipboardCopy, Crown, Library, Loader2, MessageSquarePlus, MoreHorizontal, Pencil, Phone, Pin, Plus, Search, TextQuote, Trash2, Users, X } from "lucide-react";
import { api, useStore, formatTime, visibleMessages, botOpensTo, openBot, openThread, type Action, type AppState, type Bot, type Group, type InstanceInfo, type Message } from "@/state/store";
import { SidebarWorkingStep } from "./SidebarWorkingStep";

import { BotAvatar } from "./Avatar";
import { BotEngineMark, BotModelBadge, botTooltip } from "./BotModelBadge"; import { SidebarBotRole } from "./BotRole";
import { stateForBot } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { searchMatchesThreads, useSearchDisclosure } from "@/lib/search-disclosure";
import { useHeldMenuMotion, useMenuMotion } from "./MenuMotion";
import { lastNonReceipt } from "@/lib/receipts";
import { botPreview, groupPreview } from "./sidebar-preview";
import { activeLocale, t } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import type { LocaleKey } from "@/locales";
import { ConfirmDialog } from "./ConfirmDialog";
 
import { StackedMauses } from "./StackedMauses";
import { nextRename } from "@/lib/rename";
import { useDesktopCapabilities, windowFramed } from "./DesktopCapabilities";
import { MIN_QUERY, SearchResults } from "./SearchResults";
import { TeamLibraryPanel } from "./lazy-screens";
import { SidebarNewChatPanel } from "./SidebarNewChatPanel";
import { openCommandPalette } from "./CommandPalette";
import { RenameTitle } from "./RenameTitle";
import { GroupThreadList } from "./SidebarGroupThreadList";
import { setSidebarDensity, useSidebarDensity, usePinnedCircles, useUniversalPins, type SidebarDensity } from "@/lib/sidebar-preferences";
import {
  BOT_CHATS_SECTION_ID,
  BOTS_SECTION_ID,
  CHANNELS_SECTION_ID,
  PINNED_SECTION_ID,
  TOOLS_SECTION_ID,
  partitionSidebarBots,
  partitionSidebarGroups,
  sidebarSectionLabel,
  withPrimaryTile,
} from "@/lib/sidebar-layout";
import { stepKey, type BotDropPlace } from "@/lib/sidebar-bot-drop";
import { BotDropLine, botRowDropClass, useSidebarBotDrag, type BotRowDrag } from "./SidebarBotDrag";
import { useSidebarSections } from "./SidebarSections";
import { sidebarSectionAttention } from "@/lib/sidebar-attention";
import { botListItemPointerIntent } from "@/lib/sidebar-selection";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarPhoneBar } from "./SidebarPhoneBar";
import { PhoneHero } from "./SidebarPhoneHero";
import { SidebarProfileMenu } from "./SidebarProfileMenu";
import { PHONE_LAYOUT, useMediaQuery } from "@/lib/use-media-query";
import { GlassBar, GlassScrollFrame, GlassScroller } from "./GlassScrollFrame";
import { SidebarSectionHeader } from "./SidebarSectionHeader";

import { MENU_ITEM, MENU_SHEET, navigateMenu } from "./menu-recipe";
import { ELEVATED_CONTROL } from "./elevated";
import { SidebarResizeHandle, useSidebarWidth } from "./SidebarResizeHandle";
import { PHONE_TOP_BUTTON, SIMPLE_CORNER_BUTTON, SIMPLE_ROW_FOCUS, SIMPLE_TOP_BUTTON, SidebarSearchPill, SidebarSearchToggle } from "./SidebarSimpleTop";
import { isSidebarToggle } from "@/lib/keyboard-shortcuts";
import { SidebarRailSeparator, SimpleRailFooter } from "./SidebarSimpleRail";
import { useBotUnread } from "./unread-notice";
import { SidebarBotActivity, sidebarBotActivityTasks, sidebarBotStatus } from "./SidebarBotActivity";
import { SidebarTileGrid } from "./SidebarTiles";
import { BotContextMenu } from "./SidebarBotMenu";
export { BotContextMenu };
import { AvatarActivityDot, RowDot, RowStatusText, rowSurface } from "./SidebarRowMarkers";


import { useLiveMedia } from "@/lib/live-call-media";
import { LiveCallPill, liveBadgeFor } from "./LiveCallPill";
import { ShortcutHint } from "./ShortcutHint";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { useAdvancedMode } from "@/lib/interface-mode";
import { defaultBotIn, useWelcomingBot } from "@/lib/default-bot";
import { PinnedBotRoster } from "./PinnedCircles";
import { archiveBotWithNotice } from "./bot-archive";
import { ArchivedBotsPanel, botConfirmProps, type BotConfirmKind } from "./ArchivedBotsPanel";
import { NewRoomPanel } from "./SidebarNewRoomPanel";

export { ArchivedBotRow, ArchivedBotsPanel, archivedDeleteAllCopy, botConfirmCopy, type BotConfirmKind } from "./ArchivedBotsPanel";
import { roomDeleteCopy } from "./room-delete-copy"; export { roomDeleteCopy };

/** The centre of macOS's traffic lights (14px tall) with the window's frame off, where the window puts them at 16,16. */
export const MAC_TRAFFIC_LIGHT_CENTER_Y = 23;

const SECTION_LABEL_KEYS: Record<string, LocaleKey> = {
  [PINNED_SECTION_ID]: "sidebar.section.pinned",
  [CHANNELS_SECTION_ID]: "sidebar.section.channels",
  [BOT_CHATS_SECTION_ID]: "sidebar.section.botChats",
  [BOTS_SECTION_ID]: "sidebar.section.bots",
};

function sectionLabel(id: string): string {
  const key = SECTION_LABEL_KEYS[id];
  return key ? t(key) : sidebarSectionLabel(id);
}

export interface MenuState {
  botId: string;
  x: number;
  y: number;
}

export function openBotContextMenu(onMenu: (menu: MenuState) => void, botId: string, event: React.MouseEvent) {
  event.preventDefault();
  onMenu({ botId, x: event.clientX, y: event.clientY });
}

export function GroupListItem({
  group,
  density,
  query = "",
  onMenu,
}: {
  group: Group;
  density: SidebarDensity;
  query?: string;
  onMenu: (menu: { groupId: string; x: number; y: number }) => void;
}) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const selected = state.activeView === "chat" && state.selectedId === group.id;
  const [threadsOpen, setThreadsOpen] = useSearchDisclosure(`group:${group.id}`, query ?? "", searchMatchesThreads(query ?? "", group.tasks), selected);
  const wasSelected = useRef(selected);
  useEffect(() => {
    if (selected && !wasSelected.current) setThreadsOpen(true);
    wasSelected.current = selected;
  }, [selected]);
  const hasThreadList = (group.tasks?.length ?? 1) > 1 || Boolean(query);
  const expanded = !group.dm && threadsOpen && density !== "icons" && hasThreadList;
  const simpleRow = !advanced && density === "comfortable";
  const railTile = !advanced && density === "icons";
  const roomBusy = Boolean(group.busyBotId) || Boolean(group.working);
  const members = group.memberIds
    .map((id) => state.bots.find((b) => b.id === id))
    .filter((b): b is Bot => Boolean(b));
  const last = group.messages.at(-1);
  return (
    <>
    <div className={cn("group relative", railTile && "mx-auto w-[54px]")}>
    <button
      data-sidebar-group-row={group.id}
      aria-current={selected && !expanded ? "page" : undefined}
      onClick={() => dispatch({ type: "select", id: group.id })}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ groupId: group.id, x: e.clientX, y: e.clientY });
      }}
      // The ContextMenu key's native event carries no useful coordinates.
      onKeyDown={(e) => {
        if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onMenu({ groupId: group.id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      className={cn(
        "relative flex w-full items-center rounded-md text-left", SIMPLE_ROW_FOCUS,
        density === "icons" ? (railTile ? "h-[54px] justify-center" : "justify-center px-1 py-1.5") : simpleRow
          ? cn("gap-2 rounded-[10px] py-2 pr-2 group-hover:pr-9 group-focus-within:pr-9 max-md:pr-9 touch:pr-9 md:h-[54px] md:py-0", !group.dm && hasThreadList ? "pl-6" : "pl-2") : "gap-2 py-1.5 pl-6 pr-9",
        selected && !expanded ? "bg-raised" : "hover:bg-raised/50",
      )}
      title={density === "icons" ? group.name : undefined}
      aria-label={density === "icons" ? group.name : undefined}
    >
      <StackedMauses members={members} density={railTile ? "comfortable" : density} large={simpleRow || railTile} />
      <div className={cn("min-w-0 flex-1", density === "icons" && "hidden")}>
        <div className={cn("flex items-baseline justify-between gap-2", simpleRow && "pr-7")}>
          <span className={cn("truncate text-[14px] text-ink", simpleRow ? "font-medium leading-5" : "font-semibold")}>{group.name}</span>
          {advanced && selected && last && !expanded && <span className="shrink-0 text-[10px] text-ink-secondary">{formatTime(last.at)}</span>}
          {!simpleRow && expanded && group.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label={t("task.unreadMany")} />}
          {simpleRow && !expanded && group.unread && <RowDot />}
        </div>
        {!expanded && <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-ink-secondary", simpleRow ? "text-[13px] leading-[18px]" : "text-[11px]")}>{group.description || groupPreview(group, state.bots, state.instances, advanced)}</span>
          {!simpleRow && group.unread && <span className="size-2 shrink-0 rounded-full bg-accent" />}
        </div>}
        {simpleRow && <RowStatusText unread={group.unread} />}
      </div>
      {density === "icons" && group.unread && (
        <span className={cn("absolute size-2 rounded-full border border-panel bg-accent", railTile ? "right-1 top-1" : "bottom-1.5 right-1.5")} />
      )}
    </button>
    {!group.dm && density !== "icons" && hasThreadList && <button type="button" aria-label={t(expanded ? "task.collapseNamed" : "task.expandNamed", { name: group.name })} aria-expanded={expanded}
      onClick={() => setThreadsOpen((open) => !open)} className="absolute left-0.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-secondary outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60">
      <ChevronRight aria-hidden="true" size={12} className={cn("transition-transform", expanded && "rotate-90")} />
    </button>}
    {!group.dm && density !== "icons" && <button type="button" disabled={roomBusy} aria-label={t("task.newShort")} title={t(roomBusy ? "task.newBusy" : "task.newShort")}
      onClick={() => { setThreadsOpen(true); dispatch({ type: "newGroupTask", groupId: group.id }); }}
      className="pointer-events-none absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary opacity-0 hover:bg-raised hover:text-ink disabled:opacity-40 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70 touch:disabled:opacity-40"><Plus size={14} /></button>}
    </div>
    {expanded && <GroupThreadList group={group} selected={selected} query={group.name.toLowerCase().includes(query.toLowerCase()) ? "" : query} />}
    </>
  );
}

function RoomContextMenu({
  menu,
  onClose,
  onDelete,
}: {
  menu: { groupId: string; x: number; y: number } | null;
  onClose: () => void;
  onDelete: (groupId: string) => void;
}) {
  const motion = useHeldMenuMotion(menu);
  const shown = motion.value;
  const { state, dispatch } = useStore();
  const group = shown ? state.groups.find((g) => g.id === shown.groupId) : undefined;
  const [renaming, setRenaming] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [draft, setDraft] = useState(group?.name ?? "");
  const [descriptionDraft, setDescriptionDraft] = useState(group?.description ?? "");

  useEffect(() => {
    if (!menu) return;
    setDraft(state.groups.find((g) => g.id === menu.groupId)?.name ?? "");
    setDescriptionDraft(state.groups.find((g) => g.id === menu.groupId)?.description ?? "");
    setRenaming(false);
    setDescribing(false);
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-room-menu]")) onClose();
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

  if (!motion.shown || !group || !shown) return null;
  const isBotChat = Boolean(group.dm);
  const saveRename = () => {
    const name = nextRename(group.name, draft);
    if (name) dispatch({ type: "patchGroup", groupId: group.id, patch: { name } });
    onClose();
  };
  const saveDescription = () => {
    const trimmed = descriptionDraft.trim();
    if (trimmed !== (group.description ?? "")) {
      dispatch({ type: "patchGroup", groupId: group.id, patch: { description: trimmed } });
    }
    onClose();
  };
  const top = Math.min(shown.y, window.innerHeight - 204);
  const left = Math.min(shown.x, window.innerWidth - 240);
  return createPortal(
    <div
      data-room-menu
      data-sidebar
      role="menu"
      aria-label={t("sidebar.bot.actions", { name: group.name })}
      onKeyDown={navigateMenu}
      style={{ top, left }}
      className={cn("fixed z-40 w-[228px] overflow-hidden", MENU_SHEET, motion.className)} {...motion.exitProps}
    >
      {describing ? (
        <div className="flex items-center gap-1 px-2 py-1">
          <input
            autoFocus
            value={descriptionDraft}
            maxLength={120}
            placeholder={t("sidebar.room.descriptionPlaceholder")}
            aria-label={t("sidebar.room.descriptionAria", { name: group.name })}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDescriptionDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                saveDescription();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            className="min-w-0 flex-1 rounded-lg bg-raised px-2 py-1.5 text-[14px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={saveDescription}
            aria-label={t("sidebar.room.saveDescription")}
            title={t("common.save")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Check size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            title={t("common.cancel")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      ) : renaming ? (
        <div className="flex items-center gap-1 px-2 py-1">
          <input
            autoFocus
            value={draft}
            maxLength={100}
            aria-label={t("sidebar.room.renameAria", { name: group.name })}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                saveRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            className="min-w-0 flex-1 rounded-lg bg-raised px-2 py-1.5 text-[14px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={saveRename}
            aria-label={isBotChat ? t("sidebar.room.saveChatName") : t("sidebar.room.saveChannelName")}
            title={t("common.save")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Check size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={isBotChat ? t("sidebar.room.cancelChatRename") : t("sidebar.room.cancelChannelRename")}
            title={t("common.cancel")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <button
          role="menuitem"
          onClick={() => {
            setDraft(group.name);
            setRenaming(true);
          }}
          className={cn(MENU_ITEM, "text-ink hover:bg-menu-hover")}
        >
          <Pencil size={16} className="text-ink-secondary" />
          {isBotChat ? t("sidebar.room.renameChat") : t("sidebar.room.renameChannel")}
        </button>
      )}
      {!renaming && !isBotChat && (
        <button
          role="menuitem"
          onClick={() => {
            setDescriptionDraft(group.description ?? "");
            setDescribing(true);
          }}
          className={cn(MENU_ITEM, "text-ink hover:bg-menu-hover")}
        >
          <TextQuote size={16} className="text-ink-secondary" />
          {t("sidebar.room.setDescription")}
        </button>
      )}
      <button
        role="menuitem"
        onClick={() => {
          void copyText(group.threadId);
          onClose();
        }}
        className={cn(MENU_ITEM, "text-ink hover:bg-menu-hover")}
      >
        <ClipboardCopy size={16} className="text-ink-secondary" />
        {t("sidebar.copyConversationId")}
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          onDelete(group.id);
        }}
        className={cn(MENU_ITEM, "text-danger hover:bg-menu-hover")}
      >
        <Trash2 size={16} />
        {isBotChat ? t("sidebar.room.deleteChat") : t("sidebar.room.deleteChannel")}
      </button>
    </div>,
    document.body,
  );
}

/** A confirmation may span live fleet updates; never authorize from its snapshot. */
export function currentArchivableBot(bots: readonly Bot[], id: string): Bot | undefined {
  const active = bots.filter((candidate) => !candidate.hidden);
  if (active.length <= 1) return undefined;
  return active.find((candidate) => candidate.id === id && !candidate.chiefOfStaff && !candidate.defaultBot);
}

export interface BotRowProps {
  bot: Bot;
  selected: boolean;
  deleting: boolean;
  mascotMotion: AppState["mascotMotion"];
  pendingQueued: AppState["pendingQueued"];
  instances: InstanceInfo[];
  liveCall: AppState["liveCall"];
  locale: string;
  density: SidebarDensity;
  dispatch: Dispatch<Action>;
  onMenu: (menu: MenuState) => void;
  renameRequest?: number;
  botDrag?: BotRowDrag;
  botDrop?: BotDropPlace | null;
  botDragging?: boolean;
}

export function botRowProps(
  state: AppState,
  dispatch: Dispatch<Action>,
  bot: Bot,
  layout: Pick<BotRowProps, "density" | "onMenu" | "renameRequest" | "botDrag" | "botDrop" | "botDragging">,
): BotRowProps {
  const selected = state.activeView === "chat" && state.selectedId === bot.id;
  return {
    ...layout,
    bot,
    selected,
    deleting: state.deletingBots[bot.id] === true,
    mascotMotion: selected && state.mascotMotion?.botId === bot.id ? state.mascotMotion : null,
    pendingQueued: state.pendingQueued,
    instances: state.instances,
    liveCall: state.liveCall,
    locale: activeLocale(),
    dispatch,
  };
}

export function useVisibleMessages(bot: Bot): Message[] {
  const { messages, activeLeafId } = bot;
  return useMemo(() => visibleMessages({ messages, activeLeafId }), [messages, activeLeafId]);
}

export const BotListItem = memo(function BotListItem(props: BotRowProps) {
  const advanced = useAdvancedMode();
  const { bot, selected, deleting, mascotMotion, pendingQueued, instances, liveCall, density, dispatch, onMenu, renameRequest, botDrag: drag, botDrop: drop, botDragging: dragging } = props;
  const liveMedia = useLiveMedia();
  const [renaming, setRenaming] = useState(false);
  const iconOnly = density === "icons";
  useEffect(() => { if (iconOnly) setRenaming(false); }, [iconOnly]);
  const simpleRow = !advanced && density === "comfortable";
  const simpleList = !advanced && !iconOnly;
  const railTile = iconOnly && !advanced;
  const avatarSize = iconOnly ? (railTile ? 36 : 44) : simpleRow ? 36 : 44;
  const tooltip = simpleList ? botTooltip(bot, instances) : undefined;
  const visible = useVisibleMessages(bot);
  const last = lastNonReceipt(visible);
  const title = bot.title.trim();
  const details = [title, bot.chiefOfStaff ? t("sidebar.bot.chiefOfStaff") : ""].filter(Boolean);
  const rowClass = cn(
    "flex w-full items-center rounded-xl text-left transition-colors duration-150", SIMPLE_ROW_FOCUS,
    iconOnly
      ? railTile ? "h-[54px] justify-center" : "justify-center px-1 py-1.5"
      : simpleRow ? "gap-2 rounded-[10px] py-2 pl-2 pr-2 md:h-[54px] md:py-0"
        : "gap-3 py-2 pl-2.5 pr-9",
    !iconOnly && "max-md:rounded-2xl max-md:py-2.5",
    selected ? "bg-raised" : "hover:bg-raised/50",
    simpleRow && rowSurface(selected),
  );
  const { waiting, working, teammateWait, queued } = sidebarBotStatus(bot, pendingQueued);
  const { unread, noticing } = useBotUnread(bot);
  const onLiveCall = liveBadgeFor(bot.id, liveMedia, liveCall);
  const body = (
    <>
      <span className={cn("relative flex shrink-0", simpleRow && "-m-[3px]")} title={iconOnly || simpleList ? undefined : [bot.name, ...details].join(" · ")}>
        <BotAvatar
          bot={bot}
          state={stateForBot({ ...bot, messages: visible })}
          size={simpleRow ? avatarSize + 6 : avatarSize}
          motion={mascotMotion?.kind ?? "none"}
          motionKey={mascotMotion?.nonce ?? 0}
          animated={working || noticing || (mascotMotion?.kind ?? "none") !== "none"}
        />
        {/* Bottom-left, clear of the status dots on the right and of the row's hover actions. */}
        {(iconOnly || !simpleList) && <BotModelBadge bot={bot} instances={instances} avatarSize={avatarSize} />}
        {simpleRow && <AvatarActivityDot activity={working ? "working" : teammateWait ? "teammate" : queued && !waiting ? "queued" : null} />}
        {!simpleRow && working && (
          <span
            data-testid="working-dot"
            className={cn(
              "absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-panel bg-success",
              iconOnly ? "size-3" : "size-2.5",
            )}
          />
        )}
        {!simpleRow && waiting && <span data-testid="waiting-dot" role="status" aria-label={t("sidebar.preview.waiting")} title={t("sidebar.preview.waiting")}
          className={cn("absolute -right-0.5 -bottom-0.5 flex items-center justify-center overflow-hidden rounded-full border-2 border-panel bg-warning font-black text-panel", iconOnly ? "size-5 text-[14px]" : "size-4 text-[12px]")}><span aria-hidden="true">!</span></span>}
        {!simpleRow && teammateWait && <span data-testid="teammate-wait-dot" role="status" aria-label={t("sidebar.preview.waitingOnTeammate")} title={t("sidebar.preview.waitingOnTeammate")}
          className={cn("absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-panel bg-accent", iconOnly ? "size-3" : "size-2.5")} />}
        {!simpleRow && !teammateWait && !waiting && !working && queued && <span data-testid="queued-dot" role="status" aria-label={t("task.queued")} title={t("task.queued")}
          className={cn("absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-panel bg-ink-secondary", iconOnly ? "size-3" : "size-2.5")} />}
        {bot.chiefOfStaff && (iconOnly || simpleRow) && (
          <span className="absolute -left-1 -top-1 flex rounded-full bg-raised p-[3px]">
            <Crown size={11} strokeWidth={2.25} className="shrink-0 text-accent" role="img" aria-label={t("sidebar.bot.chiefOfStaff")} data-testid="chief-crown">
              <title>{t("sidebar.bot.chiefOfStaff")}</title>
            </Crown>
          </span>
        )}
        {onLiveCall && iconOnly && (
          <span className="absolute -right-1 -top-1 flex rounded-full bg-panel p-0.5">
            <Phone className="size-3 shrink-0 text-success" role="img" aria-label={t("call.live.badge")} data-testid="live-call-badge">
              <title>{t("call.live.badge")}</title>
            </Phone>
          </span>
        )}
      </span>
      <div className={cn("min-w-0 flex-1", iconOnly && "hidden")}>
        <div className={cn("flex items-baseline justify-between gap-2", simpleRow && "pr-7")}>
          <span className={cn("flex min-w-0 grow items-center gap-1.5 truncate text-ink", simpleRow ? "text-[14px] font-medium leading-5" : "text-[15px] font-semibold leading-5")}>
            {!simpleList && bot.pinned && <Pin size={12} className="shrink-0 text-ink-secondary" />}
            <RenameTitle
              key={iconOnly ? "icons" : "expanded"}
              value={bot.name}
              editRequest={renameRequest}
              title={tooltip}
              onCommit={(name) => dispatch({ type: "updateBot", botId: bot.id, patch: { name } })}
              onEditingChange={setRenaming}
              className="truncate"
              inputClassName={cn("w-full rounded bg-inset px-1 py-0.5", simpleRow ? "text-[14px] font-medium" : "text-[15px] font-semibold")}
            />
            {!simpleList && bot.chiefOfStaff && !renaming && (
              <Crown size={13} strokeWidth={2.25} className="shrink-0 text-accent" role="img" aria-label={t("sidebar.bot.chiefOfStaff")} data-testid="chief-crown">
                <title>{t("sidebar.bot.chiefOfStaff")}</title>
              </Crown>
            )}
            {onLiveCall && !iconOnly && !renaming && (
              <Phone className="size-3 shrink-0 text-success" role="img" aria-label={t("call.live.badge")} data-testid="live-call-badge">
                <title>{t("call.live.badge")}</title>
              </Phone>
            )}
            {!simpleList && title && !renaming && <SidebarBotRole role={title} />}
          </span>
          {last && !renaming && (
            <span className={cn(
              "shrink-0 text-[12px] tabular-nums text-ink-secondary transition-opacity",
              // Phones show the time on every row; elsewhere only the selected row, until its actions appear.
              selected && !simpleList ? "group-hover:opacity-0 group-focus-within:opacity-0 touch:opacity-0 max-md:touch:opacity-100" : "hidden max-md:inline",
            )}>
              {formatTime(last.at)}
            </span>
          )}
          {simpleRow && (unread || waiting) && <RowDot waiting={waiting} />}
        </div>
        <div className="flex items-center justify-between gap-2">
          {deleting ? (
            <span role="status" className="flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px] text-ink-secondary">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              {t("sidebar.bot.deletingRow")}
            </span>
          ) : (
            <span className={cn("flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px]", waiting ? simpleRow ? "text-warning" : "font-semibold text-warning" : "text-ink-secondary")}>
              {working ? (
                <SidebarWorkingStep bot={bot} last={last} />
              ) : (
                <span dir="auto" className="truncate">{waiting ? t("sidebar.preview.waiting") : teammateWait ? t("sidebar.preview.waitingOnTeammate") : queued ? t("task.queued") : botPreview(bot, visible, instances, advanced)}</span>
              )}
            </span>
          )}
          {simpleRow && <BotEngineMark bot={bot} instances={instances} className="ms-auto" />}
          {!simpleRow && unread && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label={t("task.unreadMany")} />}
        </div>
        {simpleRow && <RowStatusText working={working} unread={unread} />}
      </div>
    </>
  );
  const onContextMenu = (event: React.MouseEvent) => {
    openBotContextMenu(onMenu, bot.id, event);
  };
  const onSelect = (event: React.MouseEvent) => {
    if (renaming) return;
    const insideRenameInput = event.target instanceof HTMLInputElement;
    if (botListItemPointerIntent(event.type, insideRenameInput) === "select") {
      openBot(dispatch, bot);
    }
  };

  return (
    <>
    <div className={cn("group relative", railTile && "mx-auto w-[54px]", botRowDropClass(dragging))} data-bot-drop={drop ?? undefined} {...(drag && !renaming ? drag.row(bot.id) : {})}
      title={railTile ? botTooltip(bot, instances) : iconOnly ? [bot.name, bot.title?.trim()].filter(Boolean).join(" · ") : undefined}><BotDropLine place={drop} />
      {/* Keep this wrapper mounted: replacing it remounts RenameTitle and leaves the row stuck in rename mode. */}
      <div
        role={renaming ? undefined : "button"}
        tabIndex={renaming ? undefined : 0}
        aria-label={
          !renaming && iconOnly
            ? deleting
              ? t("sidebar.bot.deletingAria", { name: bot.name })
              : `${bot.name}${bot.title?.trim() ? ` · ${bot.title.trim()}` : ""}${bot.chiefOfStaff ? ` · ${t("sidebar.bot.chiefOfStaff")}` : ""}${onLiveCall ? ` · ${t("call.live.badge")}` : ""}${waiting ? ` · ${t("sidebar.preview.waiting")}` : working ? ` · ${t("chat.activity.working")}` : teammateWait ? ` · ${t("sidebar.preview.waitingOnTeammate")}` : queued ? ` · ${t("task.queued")}` : ""}${unread ? ` · ${t("task.unread")}` : ""}`
            : undefined
        }
        aria-busy={deleting || undefined} aria-keyshortcuts={drag ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
        aria-current={selected && !renaming ? "page" : undefined}
        data-sidebar-bot-row={bot.id}
        title={renaming ? undefined : tooltip}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (renaming) return;
          if (drag && stepKey(event)) { event.preventDefault(); drag.step(bot.id, stepKey(event)!); return; }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openBot(dispatch, bot);
          }
        }}
        onContextMenu={onContextMenu}
        className={rowClass}
      >
        {body}
      </div>
      {!renaming && iconOnly && unread && (
        <span className={cn("pointer-events-none absolute size-2 rounded-full border border-panel bg-accent", railTile ? "right-1 top-1" : "bottom-1.5 right-1.5")} />
      )}
      {!renaming && !deleting && !iconOnly && <>
        <button type="button" data-bot-actions={bot.id} aria-label={t("sidebar.bot.actions", { name: bot.name })} title={t("sidebar.bot.actions", { name: bot.name })} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ botId: bot.id, x: rect.left, y: rect.bottom }); }}
          className={cn("absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink", simpleRow && "right-2 top-1 translate-y-0 rounded-lg",
            selected && !simpleRow ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70")}><MoreHorizontal size={15} /></button>
      </>}
      {deleting && iconOnly && (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-card p-1 text-ink-secondary">
          <Loader2 size={12} className="animate-spin" />
        </span>
      )}
    </div>
    {(advanced || !iconOnly) && <SidebarBotActivity bot={bot} rowThreadId={selected ? bot.threadId : botOpensTo(bot)} density={density} dispatch={dispatch} />}
    </>
  );
});

export function Sidebar({ open, onClose, collapseToIcons = false }: {
  open: boolean;
  onClose: () => void;
  collapseToIcons?: boolean;
}) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const phone = useMediaQuery(PHONE_LAYOUT, false);
  const importReturnRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState<{ kind: BotConfirmKind; bot: Bot } | null>(null);
  const cancelConfirm = useCallback(() => setConfirm(null), []);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renameRequest, setRenameRequest] = useState<{ botId: string; nonce: number } | null>(null);
  const [roomMenu, setRoomMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const deletingRoom = deletingRoomId ? state.groups.find((g) => g.id === deletingRoomId) : undefined;
  const [plusOpen, setPlusOpen] = useState(false);
  const plusMotion = useMenuMotion(plusOpen);
  const advanced = useAdvancedMode();
  const [newRoom, setNewRoom] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [teamLibraryOpen, setTeamLibraryOpen] = useState(false);
  const [teamInstallUrl, setTeamInstallUrl] = useState<string | null>(null);
  const [archivedBotsOpen, setArchivedBotsOpen] = useState(false);
  const [teamFeedback, setTeamFeedback] = useState<{
    error: boolean;
    text: string;
    restoreBot?: { id: string; name: string };
  } | null>(null);
  const [query, setQuery] = useState("");
  const storedDensity = useSidebarDensity();
  const density = collapseToIcons ? "icons" : storedDensity;
  const simple = !advanced && density !== "icons";
  const simpleDesk = simple && !phone;
  const rail = !advanced && density === "icons";
  const sidePanelOpen = state.computerOpen || state.inspectorOpen;
  const sizing = useSidebarWidth({ simple: !advanced, sidePanelOpen, sidebarRef });
  const [searchOpen, setSearchOpen] = useState(false);
  const searchShown = searchOpen || query !== "";
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const closeSearch = () => { setSearchOpen(false); setQuery(""); searchToggleRef.current?.focus(); };
  const pinnedCircles = usePinnedCircles();
  const universalPins = useUniversalPins();

  useEffect(() => {
    if (density === "icons") setQuery("");
  }, [density]);

  const toggleCollapsed = () => {
    setSidebarDensity(density === "icons" ? "comfortable" : "icons");
  };
  useEffect(() => {
    if (collapseToIcons || phone) return;
    const onKey = (event: KeyboardEvent) => { if (isSidebarToggle(event)) { event.preventDefault(); toggleCollapsed(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapseToIcons, phone, density]);

  useEffect(() => {
    if (!open || confirm || deletingRoom) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, confirm, deletingRoom]);

  const plusMenuRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(plusOpen, plusMenuRef, () => setPlusOpen(false));

  useEffect(() => window.ogb?.onPackageInstall?.((url) => {
    setTeamInstallUrl(url);
    setTeamLibraryOpen(true);
  }), []);

  useEffect(() => {
    if (!teamFeedback) return;
    const timer = window.setTimeout(() => setTeamFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [teamFeedback]);


  const requestArchive = (bot: Bot) => {
    const current = currentArchivableBot(state.bots, bot.id);
    if (current) setConfirm({ kind: "archive", bot: current });
  };

  const archiveBot = async ({ id }: Pick<Bot, "id">) => {
    const bot = currentArchivableBot(state.bots, id);
    if (bot) await archiveBotWithNotice(bot, { bots: state.bots, selectedId: state.selectedId, dispatch, notify: setTeamFeedback });
  };
  // Archives from the bot panel report here too, with the same Undo.

  const undoBotArchive = async (bot: { id: string; name: string }) => {
    setTeamFeedback(null);
    try {
      const response = await api(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
      });
      dispatch({ type: "botPatched", bot: response.bot });
      openBot(dispatch, response.bot);
      setTeamFeedback({ error: false, text: t("sidebar.archived.restored", { name: bot.name }) });
    } catch (cause) {
      setTeamFeedback({ error: true, text: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  // A framed window (WindowFrameBar) holds the traffic lights in its top bar, so the top row keeps
  // no room for them; in Simple it is only the corner holding Search and New, with the bot tiles beside it. With the
  // frame off on macOS, the traffic lights sit in the top row's corner.
  const framed = windowFramed(capabilities), corner = framed && simpleDesk;
  const lights = capabilities.windowChrome === "mac-inset" && !framed;
  const draggableChrome = capabilities.windowChrome !== "native";
  // SAFETY: Electron's -webkit-app-region is not in React's CSSProperties type; the renderer accepts it as an inline
  // style.
  const windowDragStyle = draggableChrome
    ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
    : undefined;
  // SAFETY: interactive buttons must opt out of the draggable title-bar region.
  const windowNoDragStyle = draggableChrome
    ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
    : undefined;

  const q = query.trim().toLowerCase();
  const sections = useSidebarSections({ simple, rail, density, query: q, label: sectionLabel });
  const botDrag = useSidebarBotDrag({ dispatch, announce: sections.announce });

  const matchingBots = state.bots
    .filter((b) => !b.hidden)
    .filter(
      (b) =>
        !q ||
        b.name.toLowerCase().includes(q) ||
        (b.title ?? "").toLowerCase().includes(q) ||
        botPreview(b, visibleMessages(b), state.instances, advanced).toLowerCase().includes(q),
    );
  const visibleGroups = state.groups.filter((g) => !q || g.name.toLowerCase().includes(q) || g.tasks?.some((task) => task.title.toLowerCase().includes(q)));
  const parts = partitionSidebarBots(matchingBots, { universalPins, welcoming: useWelcomingBot() });
  const { primary, chief, pinnedBots, bots } = simpleDesk ? withPrimaryTile(parts, defaultBotIn(state.bots)?.id) : { ...parts, primary: null };
  const { botChats, rooms } = partitionSidebarGroups(visibleGroups);

  const drops = botDrag.arrange({ enabled: sections.interactive && !phone, list: bots, bots: state.bots });
  const naturalSectionIds = [
    ...(pinnedBots.length > 0 && !universalPins && !simpleDesk ? [PINNED_SECTION_ID] : []),
    ...(rooms.length > 0 ? [CHANNELS_SECTION_ID] : []),
    ...(botChats.length > 0 ? [BOT_CHATS_SECTION_ID] : []),
    ...(bots.length > 0 ? [BOTS_SECTION_ID] : []),
  ];
  const layout = sections.arrange(naturalSectionIds);
  const sectionIds = layout.sectionIds;
  const tiles = simpleDesk && (primary !== null || pinnedBots.length > 0);
  const { interactive: layoutInteractive, collapsed: sectionCollapsed, toggle: toggleSection } = sections;
  const archivedBots = state.bots.filter((bot) => bot.hidden);
  const archivedEntry = { count: archivedBots.length, open: () => setArchivedBotsOpen(true) };
  const pendingBotUndo = teamFeedback?.restoreBot;
  const botRow = (bot: Bot) => botRowProps(state, dispatch, bot, { density, onMenu: setMenu, renameRequest: renameRequest?.botId === bot.id ? renameRequest.nonce : 0, ...drops.row(bot.id) });
  const railSearch = () => {
    if (collapseToIcons) return openCommandPalette();
    setSearchOpen(true);
    toggleCollapsed();
  };
  const plusItem = cn(MENU_ITEM, "text-ink hover:bg-menu-hover");
  const plusControl = (
    <div ref={plusMenuRef} className="contents">
    <button
      ref={importReturnRef}
      onClick={() => setPlusOpen((o) => !o)}
      aria-label={t("sidebar.newOrShare")}
      className={phone ? PHONE_TOP_BUTTON : corner ? SIMPLE_CORNER_BUTTON : rail || simple ? SIMPLE_TOP_BUTTON : cn(
        "flex items-center justify-center text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        density === "icons" ? "size-[46px] shrink-0 rounded-xl" : "size-8 rounded-full",
      )}
      title={t("sidebar.newOrShare")}
    >
      <Plus size={corner ? 18 : phone || simple || density === "icons" ? 20 : 18} strokeWidth={phone ? 2 : 1.5} />
    </button>
    {plusMotion.shown && (
      <>
        <div role="menu" aria-label={t("sidebar.newOrShare")} onKeyDown={navigateMenu} className={cn(
          "absolute z-40 w-max min-w-[200px] overflow-hidden", MENU_SHEET,
          rail ? "left-full top-0 ml-4" : cn("top-full", advanced ? "mt-1" : "mt-1.5", density === "icons" ? "left-0" : "right-0"),
          plusMotion.className,
        )} {...plusMotion.exitProps}>
          {advanced && <button
            onClick={() => {
              setPlusOpen(false);
              setNewChatOpen(true);
            }}
            role="menuitem"
            className={plusItem}
          >
            <MessageSquarePlus size={16} className="text-ink-secondary" />
            {t("sidebar.newChat.title")}
          </button>}
          <button
            onClick={() => { setPlusOpen(false); dispatch({ type: "newBot" }); }}
            role="menuitem"
            className={plusItem}
          >
            <BotIcon size={16} className="text-ink-secondary" />
            <span className="flex-1">{advanced ? t("sidebar.newBot") : t("sidebar.newBotSimple")}</span>
            {advanced && <ShortcutHint id="new-bot" />}
          </button>
          <button
            onClick={() => {
              setPlusOpen(false);
              setNewRoom(true);
            }}
            role="menuitem"
            className={plusItem}
          >
            <Users size={16} className="text-ink-secondary" />
            {t("sidebar.newChannel.title")}
          </button>
          <button
            onClick={() => { setPlusOpen(false); setTeamLibraryOpen(true); }}
            role="menuitem"
            className={plusItem}
          >
            <Library size={16} className="text-ink-secondary" />
            {t("sidebar.teamLibrary")}
          </button>
          {advanced && archivedBots.length > 0 && (
            <button
              onClick={() => {
                setPlusOpen(false);
                setArchivedBotsOpen(true);
              }}
              role="menuitem"
              className={plusItem}
            >
              <Archive size={16} className="text-ink-secondary" />
              <span className="flex-1">{t("sidebar.archived.title")}</span>
              <span className="text-[12px] text-ink-secondary">{archivedBots.length}</span>
            </button>
          )}
        </div>
      </>
    )}
    </div>
  );

  return (
    <aside
      ref={sidebarRef}
      tabIndex={-1}
      aria-label={t("sidebar.aria")}
      data-native-view-overlay
      data-sidebar
      onClick={(event) => {
        // The phone's list covers the whole screen: choosing the bot that is already open has to dismiss it too.
        if (phone && open && event.target instanceof Element && !(event.target instanceof HTMLInputElement) && event.target.closest("[data-sidebar-bot-row], [data-sidebar-hero]")) onClose();
      }}
      style={{ "--sidebar-width": `${sizing.width}px` } as CSSProperties}
      className={cn(
        "relative flex h-full shrink-0 flex-col border-r-[0.5px] border-edge bg-panel max-md:[--scroll-fade-surface:var(--color-app)]",
        sizing.resizing && !sizing.snapping ? "transition-none" : "transition-[width] duration-200 motion-reduce:transition-none",
        density === "icons" ? rail ? "w-[92px]" : "w-[80px]" : advanced ? "w-[320px] md:w-[var(--sidebar-width)]" : "w-[280px] md:w-[var(--sidebar-width)]",
        sidePanelOpen ? advanced ? "md:max-w-[320px]" : "md:max-w-[280px]" : "md:max-w-[calc(100vw-320px)]",
        // max-md: rather than an md: cancel: Tailwind v4 emits the native `translate`, and any value but `none` makes
        // this a containing block for its `fixed` descendants.
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-full max-md:bg-app",
        "max-md:transition-transform max-md:duration-200",
        open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      )}
    >
      <GlassScrollFrame className="flex-1" fade>
      <GlassBar edge="top">
      <div
        data-sidebar-top-row={corner ? "corner" : true}
        className={cn(
          "flex items-center",
          // The corner is no drag region and takes no clicks but its buttons': the tiles rise into the rest of it.
          density === "icons" ? "flex-col gap-1 px-2 pt-3.5 pb-1" : corner ? "pointer-events-none relative h-[34px] items-start justify-end px-1.5 pt-1.5" : simpleDesk ? "relative h-[60px] items-start pl-4 pr-4 pt-3" : "relative pl-4 pr-2",
          density !== "icons" && !simpleDesk && !lights && "h-12 max-md:h-16",
        )}
        style={corner ? undefined : density !== "icons" && lights && !simpleDesk ? { ...windowDragStyle, height: MAC_TRAFFIC_LIGHT_CENTER_Y * 2 } : windowDragStyle}
      >
        {phone ? (
          <div className="shrink-0" style={windowNoDragStyle}><SidebarProfileMenu iconOnly circle /></div>
        ) : lights ? (
          // The traffic lights span 16-76px of the window; nothing clickable starts before 88px.
          <div aria-hidden="true" data-traffic-light-space className={density === "icons" ? "h-5 w-full" : "w-[72px] shrink-0"} />
        ) : null}
        {rail && <div data-sidebar-rail-top className="flex flex-col items-center gap-2 pt-1" style={windowNoDragStyle}>
          <button type="button" onClick={railSearch} aria-label={t("sidebar.searchAria")} title={t("sidebar.searchAria")} className={SIMPLE_TOP_BUTTON}>
            <Search size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <div className="relative flex">{plusControl}</div>
        </div>}
        {density !== "icons" && <div data-sidebar-top-slot className="min-w-0 flex-1" />}
        {!rail && <div
          data-sidebar-top-buttons
          className={cn("relative flex shrink-0 items-center", density === "icons" ? "flex-col gap-1" : corner ? "pointer-events-auto" : simpleDesk ? "gap-2" : simple ? "gap-1 pl-0.5" : "ml-0.5 gap-0.5")}
          style={windowNoDragStyle}
        >
          {simpleDesk && <SidebarSearchToggle ref={searchToggleRef} corner={corner} open={searchShown} onToggle={() => (searchShown ? closeSearch() : setSearchOpen(true))} />}
          {density === "icons" && <button
            type="button"
            onClick={openCommandPalette}
            aria-label={t("sidebar.searchAria")}
            title={t("sidebar.searchAria")}
            className="flex size-[46px] shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Search size={20} strokeWidth={1.5} />
          </button>}
          {plusControl}
        </div>}
      </div>

      {phone ? null : simple ? searchShown && <SidebarSearchPill query={query} onQuery={setQuery} onClose={closeSearch} /> : <div className={cn("pt-1 pb-3", density === "icons" ? "hidden" : "px-3")}>
        <div className={cn("flex h-8 items-center gap-2 rounded-full px-3 focus-within:ring-focus", ELEVATED_CONTROL)}>
          <Search size={15} className="shrink-0 text-ink-secondary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={t("sidebar.search")}
            aria-label={t("sidebar.searchAria")}
            className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
          />
        </div>
      </div>}
      {universalPins && pinnedBots.length > 0 && !simpleDesk && (
        <div
          data-sidebar-universal-pins=""
          // vh, not %: a percentage has no height to resolve against inside the glass head.
          className="max-h-[min(40vh,280px)] shrink-0 overflow-y-auto border-b border-hairline/40 px-2 pb-2"
        >
          {density !== "icons" && !pinnedCircles && (
            <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {t("sidebar.section.pinned")}
            </div>
          )}
          <PinnedBotRoster
            bots={pinnedBots}
            density={density}
            circles={pinnedCircles}
            row={botRow}
            listItem={BotListItem}
          />
        </div>
      )}

      {tiles && <SidebarTileGrid primary={primary} pinned={pinnedBots} row={botRow} corner={corner} />}
      </GlassBar>

      {!collapseToIcons && !phone && <SidebarResizeHandle sizing={sizing} sidebarRef={sidebarRef} avatars={density === "icons"} avatarsWidth={rail ? 92 : 80}
        onAvatars={(avatars) => setSidebarDensity(avatars ? "icons" : "comfortable")} style={windowNoDragStyle} />}

      <GlassScroller className={rail ? "[scrollbar-gutter:stable_both-edges]" : simpleDesk ? "px-3" : "px-2"}>
        <div className={cn("flex flex-col", simpleDesk ? cn("gap-0.5 pb-2", !tiles && "pt-2") : advanced ? "gap-0.5" : "gap-1 pb-2 pt-2")}>
          {matchingBots.length === 0 && visibleGroups.length === 0 && q && q.length < MIN_QUERY && (
            <div className="px-3 py-6 text-center text-[13px] text-ink-secondary">{t("sidebar.noMatch", { query })}</div>
          )}
          {chief && (phone ? (
            <PhoneHero bot={chief} selected={botRow(chief).selected} onOpen={() => openBot(dispatch, chief)} onMenu={setMenu} />
          ) : (
            <div className="mb-1.5">
              <BotListItem {...botRow(chief)} />
            </div>
          ))}
          {sectionIds.map((id, index) => {
            const sectionGroupItems = id === CHANNELS_SECTION_ID ? rooms : id === BOT_CHATS_SECTION_ID ? botChats : [];
            const sectionBotItems = id === PINNED_SECTION_ID ? pinnedBots : id === BOTS_SECTION_ID ? bots : [];
            const headless = simple && id === BOTS_SECTION_ID && index === 0;
            const collapsed = !headless && sectionCollapsed(id);
            const queued = collapsed ? sectionBotItems.flatMap((bot) =>
              sidebarBotActivityTasks(bot, state.pendingQueued).filter((task) => task.queued).map((task) => `${bot.name}: ${task.title}`)) : [];
            const attention = collapsed
              ? sidebarSectionAttention(sectionBotItems, sectionGroupItems)
              : undefined;
            return (
              <div
                key={id}
                data-sidebar-section-id={id}
                {...drops.zone(id, layout.zone(id))}
                className={cn(
                  "flex flex-col",
                  advanced || simpleDesk ? "gap-0.5" : "gap-1",
                  density !== "icons" && index > 0 && !simple && "pt-3",
                )}
              >
                {rail && index > 0 && <SidebarRailSeparator />}
                {layout.dropLine(id, "before")}
                {density !== "icons" && !headless && (
                  <SidebarSectionHeader
                    name={sectionLabel(id)}
                    line={simple}
                    count={simple ? sectionBotItems.length + sectionGroupItems.length : undefined}
                    collapsed={collapsed}
                    attention={attention}
                    onToggle={layoutInteractive ? () => toggleSection(id) : undefined}
                    {...layout.header(id)}
                  />
                )}
                {collapsed && queued.length > 0 && <button type="button" onClick={() => toggleSection(id)}
                  title={`${t("task.queued")} · ${queued.join(", ")}`} aria-label={`${t("sidebar.section.expand", { name: sectionLabel(id) })} · ${t("task.queued")} · ${queued.join(", ")}`}
                  className="mx-3 mb-1 inline-flex h-7 items-center self-start rounded-full bg-raised/50 px-3 text-[13px] font-medium leading-4 text-ink-secondary hover:text-ink">{t("task.queued")} · {queued.length}</button>}
                {!collapsed && (
                  <>
                    {sectionGroupItems.map((group) => (
                      <GroupListItem
                        key={group.id}
                        group={group}
                        density={density}
                        query={q}
                        onMenu={setRoomMenu}
                      />
                    ))}
                    {id === PINNED_SECTION_ID ? (
                      <PinnedBotRoster
                        bots={sectionBotItems}
                        density={density}
                        circles={pinnedCircles}
                        row={botRow}
                        listItem={BotListItem}
                      />
                    ) : sectionBotItems.map((bot) => <BotListItem key={bot.id} {...botRow(bot)} />)}
                  </>
                )}
                {layout.dropLine(id, "after")}
              </div>
            );
          })}
          <SearchResults query={query} onLanded={() => { setQuery(""); setSearchOpen(false); }} />
        </div>
      </GlassScroller>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {sections.announcement}
      </p>

      <GlassBar edge="bottom">
      <LiveCallPill
        currentBotId={state.activeView === "chat" ? state.selectedId : null}
        onOpen={(botId, threadId) => openThread(dispatch, { botId, threadId }, state)}
        iconOnly={density === "icons"}
      />

      {rail ? <SimpleRailFooter archived={archivedEntry} /> : phone ? <SidebarPhoneBar query={query} onQuery={setQuery} /> : <SidebarFooter density={density} simple={simpleDesk} archived={archivedEntry} toolsCollapsed={sectionCollapsed(TOOLS_SECTION_ID)} onToggleTools={layoutInteractive ? () => toggleSection(TOOLS_SECTION_ID) : undefined} />}
      </GlassBar>
      </GlassScrollFrame>

      <BotContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onArchive={requestArchive}
          onDelete={(bot) => setConfirm({ kind: "delete", bot })}
          onRename={(botId) => setRenameRequest((current) => ({ botId, nonce: (current?.nonce ?? 0) + 1 }))}
        />
      <ConfirmDialog {...botConfirmProps(confirm, state.bots, { archive: (bot) => { setConfirm(null); void archiveBot(bot); }, remove: (bot) => { setConfirm(null); dispatch({ type: "deleteBot", botId: bot.id }); },
        archiveInstead: (chief) => { setConfirm(null); void archiveBotWithNotice(chief, { bots: state.bots, selectedId: state.selectedId, dispatch, notify: setTeamFeedback }); } })}
        onCancel={cancelConfirm} returnFocusRef={sidebarRef} />
      <RoomContextMenu
          menu={roomMenu}
          onClose={() => setRoomMenu(null)}
          onDelete={(groupId) => {
            sidebarRef.current?.focus();
            setDeletingRoomId(groupId);
          }}
        />
      <ConfirmDialog
        open={deletingRoom !== undefined}
        {...roomDeleteCopy(deletingRoom ?? { name: "" })}
        icon={<Trash2 size={18} />}
        returnFocusRef={sidebarRef}
        onCancel={() => setDeletingRoomId(null)}
        onConfirm={() => {
          // Read the room from live state: it may have been removed while the dialog was open.
          const groupId = deletingRoom?.id;
          setDeletingRoomId(null);
          if (groupId) dispatch({ type: "deleteGroup", groupId });
        }}
      />
      {newRoom && <NewRoomPanel onClose={() => setNewRoom(false)} />}
      {/* Portaled: below md the sidebar's translate makes it the containing block for fixed children. */}
      {newChatOpen && createPortal(
        <SidebarNewChatPanel
          anchor={sidebarRef.current}
          style={windowNoDragStyle}
          onClose={() => setNewChatOpen(false)}
          onNewBot={() => { setNewChatOpen(false); dispatch({ type: "newBot" }); }}
          onNewGroup={() => { setNewChatOpen(false); setNewRoom(true); }}
        />,
        document.body,
      )}
      {archivedBotsOpen && (
        <ArchivedBotsPanel
          bots={archivedBots}
          onClose={() => setArchivedBotsOpen(false)}
          onRestored={(message) => setTeamFeedback({ error: false, text: message })}
        />
      )}
      {teamLibraryOpen && (
        <TeamLibraryPanel
          returnFocusRef={importReturnRef}
          initialUrl={teamInstallUrl ?? undefined}
          onClose={() => {
            setTeamLibraryOpen(false);
            setTeamInstallUrl(null);
          }}
          onImported={(result) => {
            setTeamLibraryOpen(false);
            setTeamInstallUrl(null);
            setTeamFeedback({
              error: false,
              text:
                (result.members === 0 && result.presets
                  ? t("sidebar.presetsImported", { count: result.presets })
                  : result.members === 1
                  ? t("sidebar.teamImportedOne")
                  : t("sidebar.teamImportedMany", { count: result.members })) +
                (result.connections ? ` · ${t("sidebar.connectionsToFinish", { count: result.connections })}` : ""),
            });
          }}
        />
      )}
      {teamFeedback &&
        createPortal(
          <div
            role="status"
            className={cn(
              "fixed bottom-4 left-4 z-[60] max-w-[300px] rounded-xl border px-3.5 py-2.5 text-[13px] shadow-xl",
              teamFeedback.error
                ? "border-danger/30 bg-card text-danger"
                : "border-hairline/50 bg-card text-ink",
            )}
          >
            <div className="flex items-center gap-3">
              <span>{teamFeedback.text}</span>
              {pendingBotUndo && (
                <button
                  onClick={() => void undoBotArchive(pendingBotUndo)}
                  className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-raised"
                >
                  {t("common.undo")}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </aside>
  );
}
