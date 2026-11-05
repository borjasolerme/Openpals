import { useState } from "react";
import { Laptop, Server } from "lucide-react";
import { ServerGuide } from "@/components/ServerGuide";
import { t } from "@/lib/i18n";
import { ChoiceButton, StepFrame, type StepProgress } from "./StepFrame";

/** Where the bots live, asked only in the desktop app while it shows this computer: here, the simplest, or an always-on
 * server set up with a guide and paired by its link (pairing opens that server's page, which goes on from there). */
export function PlaceStep({ progress, onBack, onNext }: { progress: StepProgress | null; onBack?: () => void; onNext: () => void }) {
  const [guide, setGuide] = useState(false);
  if (guide) {
    return (
      <StepFrame progress={progress} title={t("serverGuide.title")} line={t("serverGuide.intro")} onBack={() => setGuide(false)} actions={null}>
        <ServerGuide onBack={onNext} />
      </StepFrame>
    );
  }
  return (
    <StepFrame progress={progress} title={t("onboarding.place.title")} onBack={onBack} actions={null}>
      <div className="flex flex-col gap-2">
        <ChoiceButton data-place-choice="local" icon={<Laptop size={18} />} title={t("botsHome.local")} hint={t("onboarding.place.localHint")} onClick={onNext} />
        <ChoiceButton data-place-choice="server" icon={<Server size={18} />} title={t("botsHome.server")} hint={t("onboarding.place.serverHint")} onClick={() => setGuide(true)} />
      </div>
    </StepFrame>
  );
}
