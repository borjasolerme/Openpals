import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { APP_REPOSITORY, openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { copyText, type CopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { minutesLeft } from "@/lib/pairing-time";
import { testWorkComputer, useWorkComputers, type ConnectionTest, type WorkComputer } from "@/lib/work-computers";
import { api } from "@/state/store";
import { Card } from "../bot-panel/rows";
import { PairingQr } from "../PairingQr";
import { Button, buttonClass } from "../ui/Button";

/** The newest Openpals for Mac, with the first-open steps. */
export const INSTALL_GUIDE = `${APP_REPOSITORY}/releases/latest`;

interface PairingLink { id: string; code: string; url: string | null; expiresAt: number }

/** A computer new to this guide: online now, and not online when the guide opened. */
export function newlyConnected(computers: readonly WorkComputer[] | null, onlineAtOpen: ReadonlySet<string>): WorkComputer | null {
  return (computers ?? []).find((computer) => computer.online && !onlineAtOpen.has(computer.id)) ?? null;
}

/** The step the guide highlights: install, then paste the link there. */
export function guideStep(reached: number): 1 | 2 {
  return reached >= 2 ? 2 : 1;
}

/** What the guide waits for: the link pasted there, the person's yes there, macOS's screen permissions, or nothing. */
export type GuideStatus = "paste" | "turnOn" | "screen" | "ready";
export function guideStatus({ claimed, computer }: { claimed: boolean; computer: Pick<WorkComputer, "screenReady"> | null }): GuideStatus {
  if (computer) return computer.screenReady === false ? "screen" : "ready";
  return claimed ? "turnOn" : "paste";
}

function Step({ number, step, title, children }: { number: 1 | 2; step: 1 | 2; title: string; children?: ReactNode }) {
  const active = number === step;
  const done = number < step;
  return (
    <li className={cn("flex gap-3 px-3.5 py-3 transition-colors", active && "bg-accent/8")} aria-current={active ? "step" : undefined} data-guide-step={number}>
      <span className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        done ? "bg-success text-white" : active ? "bg-accent text-white motion-safe:animate-step-glow" : "bg-fill text-ink-secondary",
      )}>
        {done ? <Check size={14} /> : number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <div className={cn("text-base font-medium", active || done ? "text-ink" : "text-ink-secondary")}>{title}</div>
        {children && <div className="flex flex-col gap-2 text-sm text-ink-secondary">{children}</div>}
      </div>
    </li>
  );
}

function OnAMac({ opened = false }: { opened?: boolean }) {
  const [open, setOpen] = useState(opened);
  return (
    <>
      <Button size="sm" variant="ghost" className="gap-1 self-start" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {t("workComputer.guide.step3.mac")}<ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <ol className="list-decimal space-y-1 rounded-lg bg-inset py-2.5 pr-3 pl-8 text-sm text-ink" data-allow-steps>
          <li>{t("workComputer.guide.allow.step1")}</li>
          <li>{t("workComputer.guide.allow.step2")}</li>
          <li>{t("workComputer.guide.allow.step3")}</li>
          <li>{t("workComputer.guide.allow.step4")}</li>
        </ol>
      )}
    </>
  );
}

function PairingLinkView({ link, now }: { link: PairingLink; now: number }) {
  const [copied, setCopied] = useState<CopyFeedback>("idle");
  const copy = (url: string) => {
    void copyText(url).then((result) => { if (result !== "empty") setCopied(result); });
  };
  return (
    <div className="flex flex-wrap items-center gap-3" data-pairing-link>
      {link.url && <PairingQr value={link.url} size={96} label={t("workComputer.guide.step2.qr")} />}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        {link.url
          ? <Button size="sm" variant="primary" onClick={() => copy(link.url!)}>
            {t(copied === "copied" ? "workComputer.guide.step2.copied" : copied === "failed" ? "common.copyFailed" : "workComputer.guide.step2.copy")}
          </Button>
          : <p>{t("workComputer.guide.step2.noLink")}</p>}
        <p className="font-mono text-ink" data-pairing-code>{t("workComputer.guide.step2.code", { code: link.code })}</p>
        <p>{t("workComputer.guide.step2.expires", { minutes: minutesLeft(link.expiresAt, now) })}</p>
      </div>
    </div>
  );
}

function Connected({ computer, screen, onUse }: { computer: WorkComputer; screen: boolean; onUse: (id: string) => void }) {
  const [test, setTest] = useState<ConnectionTest | "testing" | null>(null);
  const runTest = async () => {
    setTest("testing");
    setTest(await testWorkComputer(computer.id).catch((cause) => ({ ok: false as const, error: cause instanceof Error ? cause.message : String(cause) })));
  };
  return (
    <div className="flex flex-col gap-3 px-3.5 py-3" data-guide-connected>
      <div className="text-base font-medium text-ink">{t(screen ? "workComputer.guide.screen" : "workComputer.guide.ready", { name: computer.name })}</div>
      {screen && (computer.platform === "darwin" ? <OnAMac opened /> : <p className="text-sm text-ink-secondary">{t("workComputer.guide.screenOther")}</p>)}
      <div className="flex flex-wrap gap-2">
        <Button variant={screen ? "secondary" : "primary"} onClick={() => onUse(computer.id)}>{t("workComputer.guide.use", { name: computer.name })}</Button>
        <Button variant="ghost" className="gap-1.5" disabled={test === "testing"} onClick={() => void runTest()}>
          {test === "testing" && <Loader2 size={13} className="animate-spin" />}{t(test === "testing" ? "workComputer.guide.testing" : "workComputer.guide.test")}
        </Button>
      </div>
      {test && test !== "testing" && (test.ok ? (
        <div className="flex flex-col gap-1.5 text-sm" data-connection-test="ok">
          <p className="text-success">{t("workComputer.guide.testOk", { name: computer.name })}</p>
          {test.image && <img alt={t("workComputer.guide.testImage", { name: computer.name })} src={`data:${test.image.mimeType};base64,${test.image.data}`}
            className="max-h-40 w-auto self-start rounded-lg border border-hairline/40" />}
        </div>
      ) : <p role="alert" className="text-sm text-danger" data-connection-test="failed">{t("workComputer.guide.testFailed", { error: test.error })}</p>)}
    </div>
  );
}

/** Whether the link was used: gone from the open pairings before it expired. */
function usePairingClaimed(link: PairingLink | null, watching: boolean): boolean {
  const [claimed, setClaimed] = useState(false);
  useEffect(() => {
    setClaimed(false);
    if (!link || !watching) return;
    let alive = true;
    const check = () => void api<{ pairings: Array<{ id: string }> }>("/api/auth/pairing").then((answer) => {
      if (alive && Date.now() < link.expiresAt && !answer.pairings.some((pairing) => pairing.id === link.id)) setClaimed(true);
    }).catch(() => {});
    check();
    const timer = setInterval(check, 3_000);
    return () => { alive = false; clearInterval(timer); };
  }, [link, watching]);
  return claimed;
}

/**
 * "Add a computer": a Mac mini, a laptop, a desktop PC or a VM with a desktop. Install Openpals there and paste the link
 * made here; that computer asks once and lends itself, and this guide says what is still missing until it is ready.
 */
export function AddComputerGuide({ known, onBack, onUse }: { known: readonly string[]; onBack: () => void; onUse: (id: string) => void }) {
  const { computers } = useWorkComputers(true);
  const onlineAtOpen = useRef<Set<string> | null>(null);
  if (onlineAtOpen.current === null && computers !== null) onlineAtOpen.current = new Set(computers.filter((computer) => computer.online).map((computer) => computer.id));
  const [reached, setReached] = useState(1);
  const [link, setLink] = useState<PairingLink | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const asked = useRef(false);
  const connected = newlyConnected(computers, onlineAtOpen.current ?? new Set(known));
  const step = guideStep(reached);
  const expired = link ? link.expiresAt <= now : false;
  const claimed = usePairingClaimed(link, !connected);
  const status = guideStatus({ claimed, computer: connected });
  const reach = (value: number) => setReached((current) => Math.max(current, value));

  const makeLink = async () => {
    setMaking(true);
    setError("");
    try {
      setLink(await api<PairingLink>("/api/auth/pairing", { method: "POST", body: JSON.stringify({ scopes: ["lend"], label: t("workComputer.guide.pairingLabel") }) }));
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMaking(false);
    }
  };
  // The link is made once, as step 2 opens: nothing to click before there is something to paste.
  const opened = reached >= 2 && !connected;
  useEffect(() => {
    if (!opened || asked.current) return;
    asked.current = true;
    void makeLink();
  });
  useEffect(() => {
    if (!link) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [link]);

  return (
    <div className="flex flex-col gap-2" data-add-computer-guide data-guide-status={status}>
      <Button variant="ghost" size="sm" className="gap-1.5 self-start" onClick={onBack}><ArrowLeft size={14} />{t("workComputer.back")}</Button>
      <div className="flex flex-col gap-0.5 px-1">
        <div className="text-lg font-medium text-ink">{t("workComputer.guide.title")}</div>
        <p className="text-sm text-ink-secondary [text-wrap:pretty]">{t("workComputer.guide.intro")}</p>
      </div>
      <Card>
        {connected ? <Connected computer={connected} screen={status === "screen"} onUse={onUse} /> : (
          <ol className="flex flex-col divide-y divide-line-subtle">
            <Step number={1} step={step} title={t("workComputer.guide.step1.title")}>
              <div className="flex flex-wrap items-center gap-2">
                <a href={INSTALL_GUIDE} target="_blank" rel="noreferrer"
                  onClick={(event) => { event.preventDefault(); void openExternalLink(INSTALL_GUIDE).catch(() => {}); reach(2); }}
                  className={buttonClass({ size: "sm", variant: step === 1 ? "primary" : "secondary" }, "gap-1.5")}>
                  {t("workComputer.guide.step1.download")}<ExternalLink size={13} />
                </a>
                {step === 1 && <Button variant="ghost" size="sm" onClick={() => reach(2)}>{t("workComputer.guide.installed")}</Button>}
              </div>
            </Step>
            <Step number={2} step={step} title={t("workComputer.guide.step2.connect")}>
              <p>{t("workComputer.guide.step2.paste")}</p>
              {link && !expired && !claimed && <PairingLinkView link={link} now={now} />}
              {making && <p className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" />{t("workComputer.guide.step2.creating")}</p>}
              {!making && !claimed && (expired || error) && (
                <Button size="sm" className="self-start" onClick={() => void makeLink()}>{t("workComputer.guide.step2.again")}</Button>
              )}
              {error && <p role="alert" className="text-danger">{error}</p>}
              {step === 2 && link && !expired && (
                <p className="flex items-center gap-2 text-ink" data-guide-waiting={status}>
                  <Loader2 size={13} className="motion-safe:animate-spin" />{t(status === "turnOn" ? "workComputer.guide.waitingYes" : "workComputer.guide.waitingPaste")}
                </p>
              )}
            </Step>
          </ol>
        )}
      </Card>
      <p className="px-1 text-sm text-ink-secondary">{t("workComputer.guide.keepAwake")}</p>
    </div>
  );
}
