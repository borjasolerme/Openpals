import { CircleCheck } from "lucide-react";
import { BotAvatar } from "@/components/Avatar";
import { productName } from "@/lib/brand";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { PRIMARY, StepFrame } from "./StepFrame";

const AVATAR_SIZE = 64;

/** The end of the first run: the chat with `bot` opens, or the app where no bot was brought. */
export function DoneStep({ bot, onBack, onDone }: { bot: Bot | undefined; onBack?: () => void; onDone: () => void }) {
  const art = bot ? <BotAvatar bot={bot} size={AVATAR_SIZE} motion="arrive" /> : <CircleCheck size={48} strokeWidth={1.5} aria-hidden="true" className="text-success" />;
  return (
    <StepFrame centered art={art} title={t("onboarding.done.title")}
      line={bot ? t("onboarding.done.line", { name: bot.name }) : t("onboarding.done.lineNoBot")} onBack={onBack}
      actions={(
        <button type="button" data-primary="" onClick={onDone} className={PRIMARY}>
          {bot ? t("onboarding.done.open", { name: bot.name }) : t("onboarding.done.openApp", { app: productName() })}
        </button>
      )} />
  );
}
