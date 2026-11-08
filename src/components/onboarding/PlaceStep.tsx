import { useState } from "react";
import { Laptop, Server } from "lucide-react";
import { ServerSetup } from "@/components/ServerSetup";
import { t } from "@/lib/i18n";
import { ChoiceButton, StepFrame, type StepProgress } from "./StepFrame";

/** Where the bots live, asked only in the desktop app while it shows this computer: here, the simplest, or an always-on
 * server the app sets up and switches to (that server's page goes on from there). */
export function PlaceStep({ progress, onBack, onNext }: { progress: StepProgress | null; onBack?: () => void; onNext: () => void }) {
  const [setup, setSetup] = useState(false);
  if (setup) {
    return (
      <StepFrame progress={progress} title={t("serverSetup.title")} line={t("serverSetup.intro")} onBack={() => setSetup(false)} actions={null}>
        <ServerSetup onBack={onNext} />
      </StepFrame>
    );
  }
  return (
    <StepFrame progress={progress} title={t("onboarding.place.title")} onBack={onBack} actions={null}>
      <div className="flex flex-col gap-2">
        <ChoiceButton data-place-choice="local" icon={<Laptop size={18} />} title={t("botsHome.local")} hint={t("onboarding.place.localHint")} onClick={onNext} />
        <ChoiceButton data-place-choice="server" icon={<Server size={18} />} title={t("botsHome.server")} hint={t("onboarding.place.alwaysOnHint")} onClick={() => setSetup(true)} />
      </div>
    </StepFrame>
  );
}
