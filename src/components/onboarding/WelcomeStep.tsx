import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { brand, productName } from "@/lib/brand";
import { DEFAULT_BOT_NAME, defaultBotIn } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { PRIMARY, StepFrame } from "./StepFrame";

const MASCOT_SIZE = 72;

/** A hosted place's welcome for its admin: the app's name, its mascot and one line on the team's shared place. */
export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { state } = useStore();
  const reduced = usePrefersReducedMotion();
  const maus = defaultBotIn(state.bots);
  const logo = brand().logo;
  const art = logo ? <img src={logo} alt="" width={MASCOT_SIZE} height={MASCOT_SIZE} className="object-contain" />
    : maus ? <BotAvatar bot={maus} size={MASCOT_SIZE} animated={!reduced} />
    : <MausAvatar color="chrome" size={MASCOT_SIZE} state="idle" animated={!reduced} label={DEFAULT_BOT_NAME} />;
  return (
    <StepFrame centered art={art} title={t("onboarding.welcome.title", { app: productName() })}
      line={t("onboarding.hosted.intro")}
      actions={<button type="button" data-primary="" onClick={onNext} className={PRIMARY}>{t("onboarding.welcome.start")}</button>} />
  );
}
