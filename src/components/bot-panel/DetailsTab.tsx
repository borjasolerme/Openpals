import { Calendar, Sparkles } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { useChatMoreItems } from "../ChatMoreMenu";
import { ModelPicker } from "../ModelPicker";
import type { SidebarMenuItem } from "../SidebarPopoverMenu";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import type { SimplePageId } from "./page-registry";
import { TryAsking } from "./TryAsking";
import { Card, NavRow, RowIcon, rowCls, RowText } from "./rows";

type Derived = ReturnType<typeof useBotSettingsDerived>;

export const CONVERSATION_ITEMS = ["find", "usage", "activity"];

/** A ⋯ menu item drawn as a panel row: the same label, icon, value and handler. */
function ItemRow({ item }: { item: SidebarMenuItem }) {
  return (
    <button
      type="button"
      data-panel-item={item.key}
      disabled={item.disabled}
      aria-pressed={item.active || undefined}
      onClick={item.onSelect}
      className={cn(rowCls, "w-full text-left enabled:hover:bg-fill-subtle disabled:cursor-default disabled:opacity-45")}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-fill-subtle text-ink-secondary [&_svg]:size-4" aria-hidden="true">
        {item.icon}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-lg font-medium", item.active ? "text-accent-text" : "text-ink")}>{item.label}</span>
      {item.trailing && <span className="flex shrink-0 items-center">{item.trailing}</span>}
    </button>
  );
}

export function DetailsTab({ bot, derived, onOpen }: {
  bot: Bot;
  derived: Derived;
  onOpen: (page: SimplePageId) => void;
}) {
  const { items } = useChatMoreItems(bot);
  const routinesOn = derived.botRoutines.filter((routine) => routine.enabled).length;
  const conversationItems = CONVERSATION_ITEMS.flatMap((key) => items.filter((item) => item.key === key));

  return (
    <div data-panel-tabpanel="details">
      <Card anchor="model">
        <div data-panel-row="model" className={rowCls}>
          <ModelPicker
            bot={bot}
            contained
            threadId={bot.threadId}
            label={<span className="flex min-w-0 flex-1 items-center gap-2.5"><RowIcon icon={Sparkles} /><RowText title={t("model.simple.model")} /></span>}
          />
        </div>
      </Card>

      {derived.botRoutines.length === 0 ? (
        <div data-panel-empty="routines" className="px-3 py-7 text-center text-base text-ink-tertiary">
          <p>{t("botPanel.routines.empty")}</p>
          <button
            type="button"
            data-panel-page="routines"
            onClick={() => onOpen("routines")}
            className="mt-1.5 rounded-md px-1.5 py-0.5 text-base font-medium text-ink-secondary hover:bg-fill-subtle hover:text-ink"
          >
            {t("botPanel.routines.add")}
          </button>
        </div>
      ) : (
        <Card label={t("botSettings.simple.routines")} anchor="routines">
          <NavRow
            data-panel-page="routines"
            icon={Calendar}
            title={t("botSettings.simple.routines")}
            value={routinesOn > 0 ? t("botPanel.routinesOn", { count: routinesOn }) : t("botPanel.none")}
            onClick={() => onOpen("routines")}
          />
        </Card>
      )}

      <TryAsking bot={bot} />

      {conversationItems.length > 0 && (
        <Card label={t("botPanel.section.conversation")} anchor="conversation">
          {conversationItems.map((item) => <ItemRow key={item.key} item={item} />)}
        </Card>
      )}
    </div>
  );
}
