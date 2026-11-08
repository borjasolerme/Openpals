import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { BotAvatar } from "@/components/Avatar";
import { GrokBotMark } from "@/components/GrokBotMark";
import { GrokMoveDialog } from "@/components/lazy-screens";
import { productName } from "@/lib/brand";
import { chiefFor, createChiefPatch, defaultBotIn } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { BringSection, ChoiceButton } from "./StepFrame";

/** What the person brought: Pal started, and the bots that came over from Grok Bot. */
export interface BroughtBots {
  pal: string | null;
  moved: readonly Bot[];
}

export const NOTHING_BROUGHT: BroughtBots = { pal: null, moved: [] };

/** The bot a first run opens: Pal when it was started here, else the first bot that moved in. */
export function firstBot(brought: BroughtBots): string | null {
  return brought.pal ?? brought.moved[0]?.id ?? null;
}

/** Bringing bots in, both optional: moving them from Grok Bot, or starting with Pal, the helper bot. */
export function BringBots({ brought, onBrought }: { brought: BroughtBots; onBrought: (brought: BroughtBots) => void }) {
  const { state, dispatch } = useStore();
  const maus = defaultBotIn(state.bots);
  const [moving, setMoving] = useState(false);
  const before = useRef<ReadonlySet<string>>(new Set());

  const startMove = () => {
    before.current = new Set(state.bots.map((bot) => bot.id));
    setMoving(true);
  };
  const endMove = () => {
    setMoving(false);
    const arrived = state.bots.filter((bot) => !before.current.has(bot.id) && !bot.hidden);
    if (arrived.length) onBrought({ ...brought, moved: [...brought.moved, ...arrived] });
  };
  const startPal = () => {
    if (!maus || brought.pal) return;
    if (!maus.welcomed || maus.sidebarHidden) dispatch({ type: "updateBot", botId: maus.id, patch: createChiefPatch(maus, chiefFor(state.bots)) });
    onBrought({ ...brought, pal: maus.id });
  };

  const done = Boolean(brought.pal || brought.moved.length);
  return (
    <BringSection title={t("onboarding.bring.bots")} line={t("onboarding.bots.line")}>
      <div className="flex flex-col gap-2">
        <ChoiceButton data-bots-choice="grok" icon={<GrokBotMark size={20} />} title={t("onboarding.bots.grok")} hint={t("onboarding.bots.grokHint")}
          done={brought.moved.length > 0} onClick={startMove} />
        {maus && !maus.hidden && (
          <ChoiceButton data-bots-choice="pal" icon={<BotAvatar bot={maus} size={28} />} title={t("onboarding.bots.pal", { name: maus.name })}
            hint={t("onboarding.bots.palHint", { app: productName() })} done={Boolean(brought.pal)} onClick={startPal} />
        )}
      </div>
      {done && (
        <p role="status" data-bots-brought="" className="flex items-center gap-1.5 text-[13px] leading-[18px] text-success">
          <Check size={14} strokeWidth={2.5} aria-hidden="true" />
          {t("onboarding.bots.ready", { names: [...(brought.pal && maus ? [maus.name] : []), ...brought.moved.map((bot) => bot.name)].join(", ") })}
        </p>
      )}
      {moving && <GrokMoveDialog onClose={endMove} />}
    </BringSection>
  );
}
