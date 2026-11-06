import { useEffect, useState } from "react";
import { CloudOff, Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { retryLiveEvents } from "@/lib/live-events";
import { Button } from "./ui/Button";
import { noteRefusedRequest } from "@/lib/session-ended";

export const RECONNECTING_AFTER_MS = 4_000;
export const CONNECTION_HELP_AFTER_MS = 20_000;

/** The live stream is down: replies and other people's messages wait until it is back. A blip shorter than a few
 * seconds says nothing. */
export function LiveConnectionStrip({ connected, hydrated }: { connected: boolean; hydrated: boolean }) {
  const [late, setLate] = useState(false);
  const [help, setHelp] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    setLate(false);
    setHelp(false);
    if (connected || !online) return;
    // The stream is a browser EventSource, so a refused handshake looks like any other drop. Ask the session endpoint
    // once it is late: an ended sign-in then shows the pairing page instead of "Connecting…" forever. An offline device
    // is not asked.
    const probe = setTimeout(() => noteRefusedRequest(), RECONNECTING_AFTER_MS);
    const timer = setTimeout(() => setLate(true), RECONNECTING_AFTER_MS);
    const helpTimer = setTimeout(() => { setHelp(true); noteRefusedRequest(); }, CONNECTION_HELP_AFTER_MS);
    return () => { clearTimeout(probe); clearTimeout(timer); clearTimeout(helpTimer); };
  }, [connected, online]);
  const notice = !online ? "offline" : !connected && late && (hydrated || help) ? "reconnecting" : null;
  if (!notice) return null;
  return <div role="status" data-live-connection={notice} className="flex flex-wrap items-center justify-center gap-2 border-b border-hairline/40 bg-panel px-3 py-1.5 text-base text-ink-secondary">
    {notice === "offline" ? <CloudOff size={14} className="shrink-0" aria-hidden="true" /> : <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />}
    <span>{t(notice === "offline" ? "liveConnection.offline" : help ? "liveConnection.help" : "liveConnection.reconnecting")}</span>
    {notice === "reconnecting" && help && <Button variant="ghost" size="sm" onClick={retryLiveEvents} className="shrink-0">
      {t("liveConnection.retry")}
    </Button>}
  </div>;
}
