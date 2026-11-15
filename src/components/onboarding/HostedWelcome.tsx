import { MausAvatar } from "@/components/Avatar";
import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { brand, productName } from "@/lib/brand";

const MASCOT_SIZE = 72;

/** The welcome's art over its title and line: the brand's logo, else the app's mascot. */
export function HostedWelcomeArt() {
  const reduced = usePrefersReducedMotion();
  const logo = brand().logo;
  if (logo) return <img src={logo} alt="" width={MASCOT_SIZE} height={MASCOT_SIZE} className="object-contain" />;
  return <MausAvatar color="chrome" size={MASCOT_SIZE} state="idle" animated={!reduced} label={productName()} />;
}
