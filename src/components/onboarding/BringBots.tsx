import { useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { GrokBotMark } from "@/components/GrokBotMark";
import { GrokMoveDialog } from "@/components/lazy-screens";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { ROW_LIST, Row, RowAction, RowStatus, Section } from "./rows";

/** What the person brought: the bot they created here, and the bots that came over from Grok Bot. */
export interface BroughtBots {
  created: Bot | null;
  moved: readonly Bot[];
}

export const NOTHING_BROUGHT: BroughtBots = { created: null, moved: [] };

/** The bot a first run opens: the one created here, else the first bot that moved in. */
export function firstBot(brought: BroughtBots): string | null {
  return brought.created?.id ?? brought.moved[0]?.id ?? null;
}

/** Bringing bots in, both optional: moving them from Grok Bot, or creating the first one with the new-bot flow. */
export function BringBots({ brought, onBrought }: { brought: BroughtBots; onBrought: (brought: BroughtBots) => void }) {
  const { state, dispatch } = useStore();
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
  const create = () => dispatch({ type: "newBot", preserveSelection: true, onCreated: (bot) => onBrought({ ...brought, created: bot }) });

  const names = [...(brought.created ? [brought.created.name] : []), ...brought.moved.map((bot) => bot.name)];
  return (
    <Section title={t("onboarding.bring.bots")} line={t("onboarding.bots.createLine")}>
      <div className={ROW_LIST}>
        <Row icon={<Plus size={18} />} title={t("onboarding.bots.create")} hint={t("onboarding.bots.createHint")}
          trailing={brought.created ? <RowStatus tone="ok">{t("onboarding.bots.added")}</RowStatus>
            : <RowAction data-bots-choice="create" onClick={create}>{t("onboarding.bots.start")}</RowAction>} />
        <Row icon={<GrokBotMark size={18} />} title={t("onboarding.bots.grok")} hint={t("onboarding.bots.grokHint")}
          trailing={brought.moved.length > 0 ? <RowStatus tone="ok">{t("onboarding.bots.added")}</RowStatus>
            : <RowAction data-bots-choice="grok" onClick={startMove}>{t("onboarding.bots.move")}</RowAction>} />
      </div>
      {names.length > 0 && (
        <p role="status" data-bots-brought="" className="flex items-center gap-1.5 text-sm text-success">
          <Check size={13} strokeWidth={2.5} aria-hidden="true" />
          {t("onboarding.bots.ready", { names: names.join(", ") })}
        </p>
      )}
      {moving && <GrokMoveDialog onClose={endMove} />}
    </Section>
  );
}
