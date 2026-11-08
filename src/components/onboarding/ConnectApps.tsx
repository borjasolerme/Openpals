import { useId, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { KEY_FIELD, KeyRow } from "@/components/keys/KeyRow";
import { cn } from "@/lib/cn";
import { looksLikeComposioPersonalKey, saveComposioPersonalKey } from "@/lib/composio-personal";
import { t } from "@/lib/i18n";
import { BringSection } from "./StepFrame";

const CARD = "rounded-2xl border border-hairline/40 bg-card";

type Saving = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

function PersonalKey() {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState<Saving>({ kind: "idle" });
  const id = useId();
  const save = async () => {
    if (!looksLikeComposioPersonalKey(key)) return setSaving({ kind: "failed", message: t("onboarding.apps.personalShape") });
    setSaving({ kind: "saving" });
    try {
      const result = await saveComposioPersonalKey(key);
      if (!result.ok) return setSaving({ kind: "failed", message: t("onboarding.apps.personalRefused", { reason: result.error || "?" }) });
      setKey("");
      setSaving({ kind: "saved" });
    } catch (cause) {
      setSaving({ kind: "failed", message: cause instanceof Error ? cause.message : String(cause) });
    }
  };
  return (
    <form data-composio-personal="" className={cn(CARD, "flex flex-col gap-2 px-4 py-3")} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">{t("onboarding.apps.personal")}</label>
      <p className="text-[12px] leading-4 text-ink-secondary">{t("onboarding.apps.personalHint")}</p>
      <div className="flex gap-2">
        <input id={id} type="password" value={key} onChange={(event) => { setKey(event.target.value); if (saving.kind === "failed") setSaving({ kind: "idle" }); }}
          placeholder="ck_…" autoComplete="off" spellCheck={false} disabled={saving.kind === "saving"} className={KEY_FIELD} />
        <button type="submit" disabled={!key.trim() || saving.kind === "saving"} className="ui-button shrink-0">
          {saving.kind === "saving" && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}
          {t("common.save")}
        </button>
      </div>
      {saving.kind === "saved" && (
        <p role="status" className="flex items-center gap-1.5 text-[12px] text-success"><Check size={13} aria-hidden="true" />{t("onboarding.apps.personalSaved")}</p>
      )}
      {saving.kind === "failed" && <p role="alert" className="text-[12px] leading-4 text-danger">{saving.message}</p>}
    </form>
  );
}

/** Connecting apps through Composio, optional: a Composio project's key, or a person's own key. */
export function ConnectApps() {
  return (
    <BringSection title={t("onboarding.bring.apps")} line={t("onboarding.apps.line")}>
      <PersonalKey />
      <div className={CARD}><KeyRow id="composio" /></div>
    </BringSection>
  );
}
