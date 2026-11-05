import { useState } from "react";
import { Check } from "lucide-react";
import { engineReady } from "@/components/EngineLibrary";
import { t } from "@/lib/i18n";
import { aiChoices, aiWorks } from "@/lib/onboarding";
import { useStore } from "@/state/store";
import { ConnectAiDialog } from "./ConnectAi";
import { SignInPill, useSignInPill } from "./SignInPill";
import { PRIMARY, QUIET, StepFrame, type StepProgress } from "./StepFrame";
import { useWelcomeAi } from "./welcome-ai";

/** Signing in to the AI the bots think with, on whichever server this page belongs to. An AI counts once it answered a
 * test message (or cannot be sent one); OpenCode's free model never does. */
export function SignInStep({ progress, onBack, onNext }: { progress: StepProgress | null; onBack?: () => void; onNext: () => void }) {
  const { state } = useStore();
  const tested = useWelcomeAi(state.instances);
  const ready = aiWorks(tested);
  const { recommended } = aiChoices(state.instances.filter((instance) => instance.install && !engineReady(instance)));
  const pill = useSignInPill(recommended);
  const [dialog, setDialog] = useState(false);
  const failure = pill.error ?? (tested?.state === "failed" ? tested.error ?? t("onboarding.engines.noAnswer", { name: tested.instance.displayName }) : null);

  return (
    <StepFrame progress={progress} title={t("onboarding.ai.title")} line={t("onboarding.ai.line")} onBack={onBack}
      actions={ready
        ? <button type="button" data-primary="" onClick={onNext} className={PRIMARY}>{t("onboarding.continue")}</button>
        : <button type="button" data-welcome-later="" onClick={onNext} className={QUIET}>{t("onboarding.ai.later")}</button>}>
      {ready && tested ? (
        <p role="status" data-ai-connected="" className="flex items-center gap-1.5 text-[14px] leading-5 text-success">
          <Check size={15} strokeWidth={2.5} aria-hidden="true" />{t("onboarding.ai.connected", { name: tested.instance.displayName })}
        </p>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <SignInPill pill={pill} instance={recommended} waiting={tested?.state === "testing"} onDialog={() => setDialog(true)} />
          {failure && <p role="alert" className="text-[13px] leading-[18px] text-danger">{failure}</p>}
          <button type="button" onClick={() => setDialog(true)} className={QUIET}>{t("onboarding.ai.otherWays")}</button>
        </div>
      )}
      {dialog && <ConnectAiDialog tested={tested} onClose={() => setDialog(false)} />}
    </StepFrame>
  );
}
