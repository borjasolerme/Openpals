import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { BringBots, type BroughtBots } from "./BringBots";
import { ConnectApps } from "./ConnectApps";
import { PRIMARY, StepFrame, type StepProgress } from "./StepFrame";

/** The last screen, all of it optional: bots to bring and apps to connect, then on into the chat with `bot` (the first
 * bot brought), or the app where none was. */
export function BringStep({ progress, brought, onBrought, bot, onBack, onDone }: {
  progress: StepProgress | null;
  brought: BroughtBots;
  onBrought: (brought: BroughtBots) => void;
  bot: Bot | undefined;
  onBack?: () => void;
  onDone: () => void;
}) {
  return (
    <StepFrame progress={progress} title={t("onboarding.bring.title")} line={t("onboarding.bring.line")} onBack={onBack}
      actions={(
        <button type="button" data-primary="" onClick={onDone} className={PRIMARY}>
          {bot ? t("onboarding.bring.open", { name: bot.name }) : t("onboarding.bring.openApp")}
        </button>
      )}>
      <div className="flex flex-col gap-8">
        <BringBots brought={brought} onBrought={onBrought} />
        <ConnectApps />
      </div>
    </StepFrame>
  );
}
