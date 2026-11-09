import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { engineReady } from "@/components/EngineLibrary";
import { InstanceProviderMark } from "@/components/ProviderIcons";
import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore, type InstanceInfo } from "@/state/store";
import { rankAis } from "../../../shared/ai-ranking";
import { ConnectAiDialog, SilentAi } from "./ConnectAi";
import { QUIET, ROW_LIST, Row, RowAction, RowStatus } from "./rows";
import { pillWay, SignInSlot, useSignInPill } from "./SignInPill";
import { useWelcomeAi, type WelcomeAiNow } from "./welcome-ai";

/** The plans the step offers by name, each on its own row; every other AI is under Other ways to connect. */
const PLAN_HINT: Readonly<Record<string, LocaleKey>> = {
  claudeAgent: "onboarding.ai.claudeHint",
  codex: "onboarding.ai.codexHint",
};

function AiRow({ instance, tested, onDialog }: { instance: InstanceInfo; tested: WelcomeAiNow | null; onDialog: () => void }) {
  const pill = useSignInPill(instance);
  const name = instance.displayName;
  const ready = engineReady(instance);
  const hintKey = PLAN_HINT[instance.driverKind];
  const hint = instance.snapshot.account?.email || (hintKey ? t(hintKey) : undefined);
  const below = !ready && (pill.slot.kind === "paste" || pill.slot.kind === "code");

  const end = () => {
    if (ready) {
      if (tested?.state === "testing") return <RowStatus tone="busy">{t("common.checking")}</RowStatus>;
      if (tested?.state === "failed") return <RowStatus tone="bad">{t("onboarding.ai.noAnswerShort")}</RowStatus>;
      return <RowStatus tone="ok">{t("onboarding.ai.signedIn")}</RowStatus>;
    }
    const { slot } = pill;
    if (slot.kind === "waiting" && slot.link) {
      const link = slot.link;
      return (
        <button type="button" data-sign-in="waiting" onClick={() => void openExternalLink(link).catch(() => {})}
          className="flex shrink-0 items-center gap-1.5 text-base text-ink-secondary transition-colors hover:text-ink">
          <LoaderCircle size={14} aria-hidden="true" className="animate-spin" />{t("onboarding.ai.waiting", { name })}
        </button>
      );
    }
    if (slot.kind === "busy" || slot.kind === "waiting" || slot.kind === "code") {
      return <RowStatus tone="busy">{t("onboarding.ai.waiting", { name })}</RowStatus>;
    }
    if (slot.kind === "paste") return null;
    const way = pillWay(instance);
    return (
      <RowAction data-sign-in={way} onClick={() => (way === "install" ? void pill.install() : way === "sign-in" ? void pill.start() : onDialog())}>
        {way === "install" ? t("onboarding.ai.installAction") : t("onboarding.ai.signInAction")}
      </RowAction>
    );
  };

  return (
    <Row data-ai-row={instance.instanceId} icon={<InstanceProviderMark instance={instance} size={16} />} title={name} hint={hint} trailing={end()}>
      {below && <SignInSlot pill={pill} name={name} />}
      {pill.error && <p role="alert" className="text-sm text-danger">{pill.error}</p>}
    </Row>
  );
}

/** Step 2: the AI the bots think with, on whichever server this page belongs to. Claude and ChatGPT each have a row that
 * says Signed in or signs in; the one the bots use answers a test message first. Every other way is in the dialog. */
export function AiStep() {
  const { state } = useStore();
  const tested = useWelcomeAi(state.instances);
  const [dialog, setDialog] = useState(false);
  const plans = rankAis(state.instances.filter((instance) => instance.driverKind in PLAN_HINT));
  // An AI the bots already use that is no plan (Gemini, a key) still shows where it stands.
  const rows = tested && !plans.some((instance) => instance.instanceId === tested.instance.instanceId) ? [tested.instance, ...plans] : plans;

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 ? (
        <div className={ROW_LIST}>
          {rows.map((instance) => (
            <AiRow key={instance.instanceId} instance={instance} onDialog={() => setDialog(true)}
              tested={tested?.instance.instanceId === instance.instanceId ? tested : null} />
          ))}
        </div>
      ) : state.instances.length === 0 && <p aria-live="polite" className="text-base text-ink-secondary">{t("common.checking")}</p>}
      {tested?.state === "failed" && <SilentAi tested={tested} />}
      <button type="button" onClick={() => setDialog(true)} className={QUIET}>{t("onboarding.ai.otherWays")}</button>
      {dialog && <ConnectAiDialog tested={tested} onClose={() => setDialog(false)} />}
    </div>
  );
}
