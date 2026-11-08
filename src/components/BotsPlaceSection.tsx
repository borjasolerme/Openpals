import { useState } from "react";
import { Laptop, Loader2, Server, Unplug } from "lucide-react";
import { t } from "@/lib/i18n";
import { disconnectServer, placeAvailable, useBotsPlace } from "@/lib/place";
import { ServerSetup } from "./ServerSetup";
import { Card } from "./SettingsPrimitives";

/** Settings → Where your bots live, in the desktop app: this computer, or the server it is paired with. */
export function BotsPlaceSection() {
  const place = useBotsPlace();
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!placeAvailable()) return null;
  const server = place?.kind === "server" ? place : null;

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await disconnectServer();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-bots-place={server ? "server" : "local"}>
      <Card title={t("botsHome.title")}>
        <div className="mt-3 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {server ? <Server size={18} aria-hidden="true" className="shrink-0 text-ink-secondary" /> : <Laptop size={18} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] text-ink">{server ? server.label : t("botsHome.local")}</div>
              <div className="break-all text-[12px] text-ink-secondary">{server ? server.url : t("botsHome.localHint")}</div>
            </div>
            {server ? (
              <button type="button" disabled={busy} onClick={() => void disconnect()} className="ui-button shrink-0">
                {busy ? <Loader2 size={14} aria-hidden="true" className="animate-spin" /> : <Unplug size={14} aria-hidden="true" />}
                {t("botsHome.disconnect")}
              </button>
            ) : !setup && (
              <button type="button" onClick={() => setSetup(true)} className="ui-button shrink-0">{t("botsHome.connect")}</button>
            )}
          </div>
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          {!server && setup && <ServerSetup onBack={() => setSetup(false)} backLabel={t("common.cancel")} />}
        </div>
      </Card>
    </div>
  );
}
