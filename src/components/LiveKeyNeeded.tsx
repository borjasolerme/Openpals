import { useId } from "react";
import { KeyRound } from "lucide-react";

import { liveDisclosure } from "@/lib/call-mode";
import { dismissLiveNotice } from "@/lib/live-call-media";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { openKeySettings } from "./keys/key-focus";

export function LiveKeyNeeded() {
  const { dispatch } = useStore();
  const titleId = useId();
  return <section aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-panel p-4 text-left">
    <div className="flex items-start gap-2.5">
      <KeyRound size={16} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" />
      <h2 id={titleId} className="text-lg font-medium leading-snug text-ink">{t("call.live.needsKey")}</h2>
    </div>
    <button type="button" className="ui-button ui-button-primary self-start" onClick={() => { dismissLiveNotice(); dispatch(openKeySettings("openai", "liveCalls")); }}>{t("call.live.openApiKeys")}</button>
    <p className="text-sm leading-normal text-ink-tertiary">{liveDisclosure()} {t("call.live.cost")}</p>
  </section>;
}
