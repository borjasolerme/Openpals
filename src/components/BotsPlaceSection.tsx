import { useState } from "react";
import { Laptop, Loader2, Server, Unplug } from "lucide-react";
import { t } from "@/lib/i18n";
import { disconnectServer, placeAvailable, useBotsPlace } from "@/lib/place";
import { useServerSetup } from "@/lib/server-setup";
import { AddServerPanel } from "./ServerSetup";
import { Card } from "./SettingsPrimitives";

/** Settings → Where your bots live, in the desktop app: this computer, or the server it is paired with. Connect to a
 * server opens the first run's own Add a server panel. */
export function BotsPlaceSection() {
  const place = useBotsPlace();
  const [opened, setOpened] = useState(false);
  const { progress } = useServerSetup();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!placeAvailable()) return null;
  const server = place?.kind === "server" ? place : null;
  // A setup under way stays in view, wherever it was started.
  const setup = opened || Boolean(progress);

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
              <div className="truncate text-lg text-ink">{server ? server.label : t("botsHome.local")}</div>
              <div className="break-all text-sm text-ink-secondary">{server ? server.url : t("botsHome.localHint")}</div>
            </div>
            {server ? (
              <button type="button" disabled={busy} onClick={() => void disconnect()} className="ui-button shrink-0">
                {busy ? <Loader2 size={14} aria-hidden="true" className="animate-spin" /> : <Unplug size={14} aria-hidden="true" />}
                {t("botsHome.disconnect")}
              </button>
            ) : !setup && (
              <button type="button" onClick={() => setOpened(true)} className="ui-button shrink-0">{t("botsHome.connect")}</button>
            )}
          </div>
          {error && <p role="alert" className="text-base text-danger">{error}</p>}
          {!server && setup && (
            <>
              <AddServerPanel />
              {!progress && (
                <button type="button" onClick={() => setOpened(false)} className="w-fit text-base text-ink-secondary transition-colors hover:text-ink">
                  {t("common.cancel")}
                </button>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
