import { t } from "@/lib/i18n";
import { localDesktopPage } from "./onboarding/WelcomeGate";

/** A routine runs where its server runs: on this computer only while it is on, or always on a server. */
export function RoutineScheduleNote() {
  const local = localDesktopPage() && window.ogb?.remoteClient?.active !== true;
  return <p data-routine-schedule-note={local ? "local" : "server"} className="text-[11px] leading-relaxed text-ink-secondary">
    {t(local ? "routines.scheduleNote.local" : "routines.scheduleNote.server")}
  </p>;
}
