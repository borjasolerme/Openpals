import { useState } from "react";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { cleanKey, saveCredential } from "../keys/key-save";
import { Button, buttonClass } from "../ui/Button";
import { Input } from "../ui/Input";

export const BOAT_SIGN_UP = "https://boat.dev";
const BOAT_KEY = /^(?:boat|box)_\S+$/;

/** No Boat key yet: what Boat is, where to get a key, and a field that saves it as Settings → API keys does. */
export function BoatKeyPanel({ onBack, onReady }: { onBack: () => void; onReady: () => void }) {
  const { dispatch } = useStore();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const key = cleanKey(value);
  const save = async () => {
    if (!BOAT_KEY.test(key)) { setError(t("workComputer.boat.badKey")); return; }
    setSaving(true);
    setError("");
    try {
      const status = await saveCredential("box", key, true);
      dispatch({ type: "configStatus", config: status });
      onReady();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-3" data-boat-key-panel>
      <Button variant="ghost" size="sm" className="gap-1.5 self-start" onClick={onBack}><ArrowLeft size={14} />{t("workComputer.back")}</Button>
      <div className="text-lg font-medium text-ink">{t("workComputer.boat.keyTitle")}</div>
      <p className="text-base text-ink-secondary">{t("workComputer.boat.explain")}</p>
      <a href={BOAT_SIGN_UP} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary" }, "gap-1.5 self-start")}>
        {t("workComputer.boat.getKey")}<ExternalLink size={14} />
      </a>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <Input type="password" autoComplete="off" spellCheck={false} aria-label={t("workComputer.boat.keyLabel")} placeholder="boat_…"
          value={value} onChange={(event) => { setValue(event.target.value); setError(""); }} className="min-w-0 flex-1" />
        <Button type="submit" variant="primary" disabled={!key || saving} className="gap-1.5">
          {saving && <Loader2 size={14} className="animate-spin" />}{t(saving ? "workComputer.boat.saving" : "workComputer.boat.save")}
        </Button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
