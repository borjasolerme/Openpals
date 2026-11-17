import { useEffect, useState } from "react";
import { KeyRound, Monitor } from "lucide-react";

import { writeComputerPanelView, type ComputerPanelView } from "@/lib/computer-panel-view";
import { t } from "@/lib/i18n";
import type { Place } from "@/lib/work-place";
import { worksOnSimpleLabel } from "@/lib/place-view";
import { sameChoice, workChoiceLabel, workChoiceOf, workPatch, type WorkChoice } from "@/lib/work-computers";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { api, useStore, type Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { screenFramePreview } from "../ScreenFrame";
import type { BotPatch, useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import type { SimplePageId } from "./page-registry";
import { Card, NavRow } from "./rows";
import { BotBrowserChoice } from "../work-computer/BrowserChoice";
import { WorkComputerPicker, WorkMoreChoices } from "../work-computer/WorkComputerPicker";

type Derived = ReturnType<typeof useBotSettingsDerived>;

export function useOpenComputer(bot: Pick<Bot, "id">) {
  const { dispatch } = useStore();
  return (view: ComputerPanelView = "computer") => {
    writeComputerPanelView(bot.id, view);
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: true });
  };
}

/** How many sites the bot's own browser is signed in to; null until read, and never asked for by a non-owner. */
function useSignedInCount(bot: Pick<Bot, "id">, enabled: boolean): number | null {
  const [count, setCount] = useState<{ botId: string; count: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void api(`/api/browser-sites?bot=${encodeURIComponent(bot.id)}`)
      .then((answer: { sites?: unknown[] }) => { if (!cancelled) setCount({ botId: bot.id, count: answer.sites?.length ?? 0 }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bot.id, enabled]);
  return count?.botId === bot.id ? count.count : null;
}

/** The chosen place in the same words as the picker, and where the bot works right now when that differs. */
function usePlaceChoices(bot: Bot) {
  const { state } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const platform = capabilities.host?.platform ?? "other";
  const myChrome = state.config?.browserEngine?.myChrome === true
    && (state.config?.browserProfiles ?? []).some((profile) => profile.id === bot.browserProfile && profile.browser === "chrome");
  const placeLabel = (place: Place) => (place === "browser" && myChrome ? t("settings.profiles.myChrome") : worksOnSimpleLabel(place, platform));
  const liveSurface = bot.tasks?.find((task) => task.threadId === bot.threadId)?.surface;
  const usingNow = liveSurface && liveSurface !== (bot.computer ?? "auto") ? placeLabel(liveSurface) : null;
  return { currentLabel: workChoiceLabel(workChoiceOf(bot)), usingNow };
}

export function WherePage({ bot, derived }: { bot: Bot; derived: Derived }) {
  const { dispatch } = useStore();
  const { usingNow } = usePlaceChoices(bot);
  const [localAutoWarning, setLocalAutoWarning] = useState<{ botId: string; patch: BotPatch } | null>(null);
  const { patch, approvalMode } = derived;
  const value = workChoiceOf(bot);
  const choose = (choice: WorkChoice) => {
    if (sameChoice(value, choice)) return;
    const next = workPatch(choice);
    if (next.computer === "local" && approvalMode === "auto") {
      setLocalAutoWarning({ botId: bot.id, patch: { computer: "local", acknowledgeLocalAuto: true } });
      return;
    }
    patch(choice.kind === "server" ? { ...next, browser: true } : next);
  };

  return (
    <>
      <div className="mt-3.5" data-panel-where>
        <WorkComputerPicker value={value} onChange={choose} more={<WorkMoreChoices value={value} onChange={choose} />} />
      </div>
      {usingNow && <p data-panel-using-now className="mx-1 mt-2 text-base text-ink-secondary">{t("computer.simple.usingNow", { place: usingNow })}</p>}
      <BotBrowserChoice bot={bot} className="mt-5 border-t border-line-subtle pt-4" />
      <LocalComputerAutoWarning
        open={localAutoWarning !== null}
        onCancel={() => setLocalAutoWarning(null)}
        onConfirm={() => {
          const target = localAutoWarning;
          setLocalAutoWarning(null);
          if (!target) return;
          dispatch({ type: "updateBot", botId: target.botId, patch: target.patch });
        }}
      />
    </>
  );
}

export function ComputerTab({ bot, derived, onOpen }: { bot: Bot; derived: Derived; onOpen: (page: SimplePageId) => void }) {
  const openComputer = useOpenComputer(bot);
  const ownerOrAdmin = useOwnerOrAdmin();
  const { browserEnabled } = derived;
  const signedIn = useSignedInCount(bot, browserEnabled && bot.computer !== "off" && ownerOrAdmin !== false);
  const { currentLabel, usingNow } = usePlaceChoices(bot);
  const screenOf = t("computer.screenOf", { name: bot.name });

  const screen = [...bot.messages].reverse().find((message) => message.kind === "screen" && (message.hasImage || message.png));
  const screenSrc = screen ? screenFramePreview({ threadId: bot.threadId, messageId: screen.id }, screen.mime).src : null;

  return (
    <div data-panel-tabpanel="computer">
      <button
        type="button"
        data-panel-action="open-computer"
        aria-label={`${t("place.action.watch")}: ${screenOf}`}
        onClick={() => openComputer()}
        className="group relative mt-2.5 flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-composer ring-1 ring-inset ring-line-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border"
      >
        {screenSrc ? (
          <img src={screenSrc} alt="" className="absolute inset-0 size-full object-cover" />
        ) : bot.busy ? (
          <>
            <span className="opacity-55"><BotAvatar bot={bot} size={52} animated={false} /></span>
            <span className="max-w-[80%] text-center text-base text-ink-secondary">{t("botPanel.screen.working")}</span>
          </>
        ) : (
          <>
            <span className="opacity-60"><BotAvatar bot={bot} size={44} state="sleeping" animated={false} /></span>
            <span className="max-w-[80%] text-center text-base font-medium text-ink">{t("botPanel.screen.resting")}</span>
          </>
        )}
        <span
          aria-hidden="true"
          className="absolute bottom-2.5 right-2.5 flex h-7 items-center gap-1.5 rounded-full border border-line bg-panel/80 px-2.5 text-sm text-ink opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100"
        >
          <Monitor size={13} aria-hidden="true" />
          {t("place.action.watch")}
        </span>
      </button>
      <div className="mt-3 text-center text-base text-ink-tertiary">{screenOf}</div>

      <Card anchor="where">
        <NavRow
          data-panel-page="where"
          icon={Monitor}
          title={t("computer.simple.whereWorks", { name: bot.name })}
          hint={usingNow ? t("computer.simple.usingNow", { place: usingNow }) : undefined}
          value={currentLabel}
          onClick={() => onOpen("where")}
        />
        <NavRow
          data-panel-page="browser"
          icon={KeyRound}
          title={t("settings.sites.title")}
          value={signedIn ?? undefined}
          onClick={() => onOpen("browser")}
        />
      </Card>
    </div>
  );
}
