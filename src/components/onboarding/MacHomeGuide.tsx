import { useState, type ReactNode } from "react";
import { Check, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import { deriveTailscalePairingStatus } from "../CompanionSection";
import { companionBridge, PhoneSetupFlowView, usePhoneSetupController } from "../PhoneSetupFlow";
import { Button } from "../ui/Button";

export const TAILSCALE_DOWNLOAD = "https://tailscale.com/download";

function GuideStep({ number, active, done, title, children }: { number: number; active: boolean; done?: boolean; title: string; children?: ReactNode }) {
  return (
    <li className={cn("flex gap-3 rounded-xl p-3", active && "bg-accent/8")} aria-current={active ? "step" : undefined} data-home-step={number}>
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        done ? "bg-success text-white" : active ? "bg-accent text-white motion-safe:animate-step-glow" : "bg-fill text-ink-secondary")}>
        {done ? <Check size={14} /> : number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="text-base font-medium text-ink">{title}</div>
        {children && <div className="flex flex-col gap-2 text-sm text-ink-secondary">{children}</div>}
      </div>
    </li>
  );
}

/** Every routine on this page's server, paused, so a moved copy never runs it twice. How many it paused. */
export async function pauseAllRoutines(request: typeof api = api): Promise<number> {
  const { routines = [] } = await request<{ routines?: Array<{ id: string; enabled: boolean }> }>("/api/routines");
  const running = routines.filter((routine) => routine.enabled);
  for (const routine of running) {
    await request(`/api/routines/${encodeURIComponent(routine.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  }
  return running.length;
}

/** "Move my bots here": the encrypted full backup, exported on the old server and restored here, in the right order. */
export function MoveBotsGuide() {
  const { dispatch } = useStore();
  const [paused, setPaused] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const openSection = (section: "backups" | "companion") => dispatch({ type: "toggleAppSettings", open: true, section });
  const pause = async () => {
    setBusy(true);
    setError("");
    try { setPaused(await pauseAllRoutines()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2" data-move-bots-guide>
      <div className="text-base font-medium text-ink">{t("macHome.move.title")}</div>
      <p className="text-sm text-ink-secondary">{t("macHome.move.intro")}</p>
      <p className="rounded-lg bg-warning/12 px-3 py-2 text-sm text-warning" role="note">{t("macHome.move.warning")}</p>
      <ol className="flex flex-col gap-1">
        <GuideStep number={1} active={paused === null} done={paused !== null} title={t("macHome.move.pause.title")}>
          <p>{t("macHome.move.pause.body")}</p>
          <Button size="sm" className="gap-1.5 self-start" disabled={busy} onClick={() => void pause()}>
            {busy && <Loader2 size={13} className="animate-spin" />}{t("macHome.move.pause.button")}
          </Button>
          {paused !== null && <p className="text-success" role="status">{t("macHome.move.pause.done", { count: paused })}</p>}
          {error && <p className="text-danger" role="alert">{error}</p>}
        </GuideStep>
        <GuideStep number={2} active={paused !== null} title={t("macHome.move.export.title")}>
          <p>{t("macHome.move.export.body")}</p>
          <Button size="sm" className="self-start" onClick={() => openSection("backups")}>{t("macHome.move.openBackups")}</Button>
        </GuideStep>
        <GuideStep number={3} active={false} title={t("macHome.move.restore.title")}>
          <p>{t("macHome.move.restore.body")}</p>
          <Button size="sm" className="self-start" onClick={() => openSection("backups")}>{t("macHome.move.openBackups")}</Button>
        </GuideStep>
        <GuideStep number={4} active={false} title={t("macHome.move.pair.title")}>
          <p>{t("macHome.move.pair.body")}</p>
          <Button size="sm" className="self-start" onClick={() => openSection("companion")}>{t("macHome.move.openRemote")}</Button>
        </GuideStep>
      </ol>
    </div>
  );
}

/** The Tailscale part: status as Remote access reads it, the one button that checks, then the pairing code. */
function TailscaleSteps() {
  const c = usePhoneSetupController();
  const [pairing, setPairing] = useState(false);
  if (!companionBridge()) return <p className="text-sm text-ink-secondary">{t("macHome.desktopOnly")}</p>;
  const status = c.state ? deriveTailscalePairingStatus(c.state, c.tailscaleAvailable) : null;
  const ready = status?.kind === "ready";
  return (
    <>
      <GuideStep number={3} active={!ready} done={ready} title={t("macHome.step.turnOn.title")}>
        <div className="flex items-start gap-2 rounded-lg bg-inset px-3 py-2.5" aria-live="polite" data-tailscale-status={status?.kind ?? "checking"}>
          <ShieldCheck size={15} className={cn("mt-0.5 shrink-0", ready ? "text-success" : "text-ink-secondary")} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">{status?.title ?? t("remote.checking")}</div>
            {status && <div className="text-sm text-ink-secondary">{status.detail}</div>}
          </div>
        </div>
        {!ready && <Button size="sm" variant="primary" className="self-start" disabled={c.busy || !c.state} onClick={c.refreshTailscale}>
          {c.busy ? t("common.checking") : c.state?.enabled ? t("remote.checkAgain") : t("remote.turnOnAndCheck")}
        </Button>}
      </GuideStep>
      <GuideStep number={4} active={ready} title={t("macHome.step.pair.title")}>
        <p>{t("macHome.step.pair.body")}</p>
        {ready && !pairing && <Button size="sm" variant="primary" className="self-start" onClick={() => { c.useTailscale(); setPairing(true); }}>{t("macHome.step.pair.button")}</Button>}
        {ready && pairing && <div className="rounded-lg bg-card p-3" data-mac-home-pairing><PhoneSetupFlowView controller={c} /></div>}
      </GuideStep>
    </>
  );
}

/** "A Mac at home": the bots' brain on an always-on Mac, reached from the laptop and phone through Tailscale. On that
 * Mac the place stays This computer. */
export function MacHomeGuide() {
  const [downloaded, setDownloaded] = useState(false);
  return (
    <div className="flex flex-col gap-3 text-left" data-mac-home-guide>
      <p className="text-sm text-ink-secondary">{t("macHome.intro")}</p>
      <p className="rounded-lg bg-inset px-3 py-2 text-sm text-ink-secondary">{t("macHome.awake")}</p>
      <ol className="flex flex-col gap-1">
        <GuideStep number={1} active={!downloaded} done={downloaded} title={t("macHome.step.download.title")}>
          <Button size="sm" className="gap-1.5 self-start"
            onClick={() => { setDownloaded(true); void openExternalLink(TAILSCALE_DOWNLOAD).catch(() => {}); }}>
            {t("macHome.step.download.button")}<ExternalLink size={13} />
          </Button>
        </GuideStep>
        <GuideStep number={2} active={false} title={t("macHome.step.signIn.title")}>
          <p>{t("macHome.step.signIn.body")}</p>
        </GuideStep>
        <TailscaleSteps />
      </ol>
      <p className="text-sm text-ink-secondary">{t("macHome.sameAccount")}</p>
      <details className="rounded-xl bg-fill-subtle p-3">
        <summary className="cursor-pointer text-base font-medium text-ink">{t("macHome.move.title")}</summary>
        <div className="mt-2"><MoveBotsGuide /></div>
      </details>
    </div>
  );
}
