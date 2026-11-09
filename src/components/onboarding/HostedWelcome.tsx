import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { brand } from "@/lib/brand";
import { DEFAULT_BOT_NAME, defaultBotIn } from "@/lib/default-bot";
import { useStore } from "@/state/store";

const MASCOT_SIZE = 72;

/** A hosted place's welcome for its admin, over its title and line: the brand's logo, else the app's mascot. */
export function HostedWelcomeArt() {
  const { state } = useStore();
  const reduced = usePrefersReducedMotion();
  const maus = defaultBotIn(state.bots);
  const logo = brand().logo;
  if (logo) return <img src={logo} alt="" width={MASCOT_SIZE} height={MASCOT_SIZE} className="object-contain" />;
  if (maus) return <BotAvatar bot={maus} size={MASCOT_SIZE} animated={!reduced} />;
  return <MausAvatar color="chrome" size={MASCOT_SIZE} state="idle" animated={!reduced} label={DEFAULT_BOT_NAME} />;
}
