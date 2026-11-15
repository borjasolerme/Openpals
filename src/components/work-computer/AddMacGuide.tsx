import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ExternalLink, Laptop, Loader2, Server } from "lucide-react";
import { APP_REPOSITORY, openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { copyText, type CopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { minutesLeft } from "@/lib/pairing-time";
import { testWorkComputer, useWorkComputers, type ConnectionTest, type WorkComputer } from "@/lib/work-computers";
import { api } from "@/state/store";
import { PairingQr } from "../PairingQr";
import { Button, buttonClass } from "../ui/Button";
import { WorkComputerBadge } from "./WorkComputerBadge";

export const INSTALL_GUIDE = `${APP_REPOSITORY}#getting-started`;

interface PairingLink { code: string; url: string | null; expiresAt: number }

/** A Mac new to this guide: online now, and not online when the guide opened. */
export function newlyConnected(computers: readonly WorkComputer[] | null, onlineAtOpen: ReadonlySet<string>): WorkComputer | null {
  return (computers ?? []).find((computer) => computer.online && !onlineAtOpen.has(computer.id)) ?? null;
}

/** The step the guide highlights: the first one not done yet. */
export function guideStep({ reached, link, connected }: { reached: number; link: boolean; connected: boolean }): 1 | 2 | 3 | 4 {
  if (connected) return 4;
  if (link || reached >= 3) return 3;
  return reached >= 2 ? 2 : 1;
}

function Step({ number, active, done, title, children }: { number: number; active: boolean; done: boolean; title: string; children?: ReactNode }) {
  return (
    <li className={cn("flex gap-3 rounded-xl p-3 transition-colors", active ? "bg-accent/8" : "bg-transparent")} aria-current={active ? "step" : undefined} data-guide-step={number}>
      <span className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        done ? "bg-success text-white" : active ? "bg-accent text-white motion-safe:animate-step-glow" : "bg-fill text-ink-secondary",
      )}>
        {done ? <Check size={14} /> : number}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("text-base font-medium", active || done ? "text-ink" : "text-ink-secondary")}>{title}</div>
        {children && <div className="mt-1.5 flex flex-col gap-2 text-sm text-ink-secondary">{children}</div>}
      </div>
    </li>
  );
}

/** A Mac reaching out to the server; the line flows while it waits and turns solid once it is connected. */
export function MacLinkIllustration({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 py-2" role="img" aria-label={t("workComputer.guide.illustration")}>
      <span className={cn("flex size-11 items-center justify-center rounded-xl", connected ? "bg-success/12 text-success" : "bg-fill text-ink")}><Laptop size={22} /></span>
      <svg width="96" height="12" viewBox="0 0 96 12" aria-hidden="true" className="shrink-0">
        <line x1="4" y1="6" x2="92" y2="6" strokeWidth="2" strokeLinecap="round" strokeDasharray={connected ? undefined : "6 10"}
          className={cn(connected ? "stroke-success" : "stroke-accent motion-safe:animate-link-flow")} />
      </svg>
      <span className="flex size-11 items-center justify-center rounded-xl bg-fill text-ink"><Server size={22} /></span>
    </div>
  );
}

function AllowSteps() {
  return (
    <ol className="list-decimal space-y-1 rounded-lg bg-inset py-2.5 pr-3 pl-8 text-sm text-ink" data-allow-steps>
      <li>{t("workComputer.guide.allow.step1")}</li>
      <li>{t("workComputer.guide.allow.step2")}</li>
      <li>{t("workComputer.guide.allow.step3")}</li>
      <li>{t("workComputer.guide.allow.step4")}</li>
    </ol>
  );
}

/** "Add a Mac": install Openpals there, connect it with a fresh pairing link, turn lending on, and watch it arrive. */
export function AddMacGuide({ known, onBack, onUse }: { known: readonly string[]; onBack: () => void; onUse: (id: string) => void }) {
  const { computers } = useWorkComputers(true);
  const onlineAtOpen = useRef<Set<string> | null>(null);
  if (onlineAtOpen.current === null && computers !== null) onlineAtOpen.current = new Set(computers.filter((computer) => computer.online).map((computer) => computer.id));
  const [reached, setReached] = useState(1);
  const [link, setLink] = useState<PairingLink | null>(null);
  const [making, setMaking] = useState(false);
  const [copied, setCopied] = useState<CopyFeedback>("idle");
  const [error, setError] = useState("");
  const [allowOpen, setAllowOpen] = useState(false);
  const [test, setTest] = useState<ConnectionTest | "testing" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!link) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [link]);
  const connected = newlyConnected(computers, onlineAtOpen.current ?? new Set(known));
  const step = guideStep({ reached, link: Boolean(link), connected: Boolean(connected) });
  const expired = link ? link.expiresAt <= now : false;

  const makeLink = async () => {
    setMaking(true);
    setError("");
    setCopied("idle");
    try {
      const offer = await api<PairingLink>("/api/auth/pairing", { method: "POST", body: JSON.stringify({ scopes: ["admin", "client"], label: t("workComputer.guide.pairingLabel") }) });
      setLink(offer);
      setNow(Date.now());
      setReached(3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMaking(false);
    }
  };
  const runTest = async (id: string) => {
    setTest("testing");
    setTest(await testWorkComputer(id).catch((cause) => ({ ok: false as const, error: cause instanceof Error ? cause.message : String(cause) })));
  };

  return (
    <div className="flex flex-col gap-3" data-add-mac-guide>
      <Button variant="ghost" size="sm" className="gap-1.5 self-start" onClick={onBack}><ArrowLeft size={14} />{t("workComputer.back")}</Button>
      <div className="text-lg font-medium text-ink">{t("workComputer.guide.title")}</div>
      <MacLinkIllustration connected={Boolean(connected)} />
      <ol className="flex flex-col gap-1">
        <Step number={1} active={step === 1} done={step > 1} title={t("workComputer.guide.step1.title")}>
          <p>{t("workComputer.guide.step1.body")}</p>
          <a href={INSTALL_GUIDE} target="_blank" rel="noreferrer"
            onClick={(event) => { event.preventDefault(); void openExternalLink(INSTALL_GUIDE).catch(() => {}); setReached((value) => Math.max(value, 2)); }}
            className={buttonClass({ size: "sm" }, "gap-1.5 self-start")}>{t("workComputer.guide.step1.button")}<ExternalLink size={13} /></a>
          {step === 1 && <Button variant="ghost" size="sm" className="self-start" onClick={() => setReached(2)}>{t("workComputer.guide.installed")}</Button>}
        </Step>
        <Step number={2} active={step === 2} done={step > 2} title={t("workComputer.guide.step2.title")}>
          <p>{t("workComputer.guide.step2.body")}</p>
          {link && !expired ? (
            <div className="flex flex-wrap items-start gap-3" data-pairing-link>
              {link.url && <PairingQr value={link.url} size={120} label={t("workComputer.guide.step2.qr")} />}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {link.url ? <code className="break-all rounded-md bg-inset px-2 py-1 text-sm text-ink">{link.url}</code>
                  : <p>{t("workComputer.guide.step2.noLink")} <span className="font-mono text-ink">{link.code}</span></p>}
                <div className="flex flex-wrap gap-2">
                  {link.url && <Button size="sm" onClick={() => void copyText(link.url!).then((result) => { if (result !== "empty") setCopied(result); })}>
                    {t(copied === "copied" ? "workComputer.guide.step2.copied" : copied === "failed" ? "common.copyFailed" : "workComputer.guide.step2.copy")}
                  </Button>}
                  <Button size="sm" variant="ghost" disabled={making} onClick={() => void makeLink()}>{t("workComputer.guide.step2.again")}</Button>
                </div>
                <p>{t("workComputer.guide.step2.expires", { minutes: minutesLeft(link.expiresAt, now) })}</p>
              </div>
            </div>
          ) : (
            <Button size="sm" variant={step === 2 ? "primary" : "secondary"} className="gap-1.5 self-start" disabled={making} onClick={() => void makeLink()}>
              {making && <Loader2 size={13} className="animate-spin" />}{t(making ? "workComputer.guide.step2.creating" : expired ? "workComputer.guide.step2.again" : "workComputer.guide.step2.create")}
            </Button>
          )}
          {error && <p role="alert" className="text-danger">{error}</p>}
        </Step>
        <Step number={3} active={step === 3} done={step > 3} title={t("workComputer.guide.step3.title")}>
          <p>{t("workComputer.guide.step3.body")}</p>
          <Button size="sm" variant="ghost" className="self-start" aria-expanded={allowOpen} onClick={() => setAllowOpen((open) => !open)}>{t("workComputer.guide.step3.howTo")}</Button>
          {allowOpen && <AllowSteps />}
        </Step>
        <Step number={4} active={step === 4} done={false} title={connected ? t("workComputer.guide.step4.connected", { name: connected.name }) : t("workComputer.guide.step4.title")}>
          {connected ? (
            <>
              <span className="flex items-center gap-2"><WorkComputerBadge computer={connected} /></span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => onUse(connected.id)}>{t("workComputer.guide.use", { name: connected.name })}</Button>
                <Button size="sm" className="gap-1.5" disabled={test === "testing"} onClick={() => void runTest(connected.id)}>
                  {test === "testing" && <Loader2 size={13} className="animate-spin" />}{t(test === "testing" ? "workComputer.guide.testing" : "workComputer.guide.test")}
                </Button>
              </div>
              {test && test !== "testing" && (test.ok ? (
                <div className="flex flex-col gap-1.5" data-connection-test="ok">
                  <p className="text-success">{t("workComputer.guide.testOk", { name: connected.name })}</p>
                  {test.image && <img alt={t("workComputer.guide.testImage", { name: connected.name })} src={`data:${test.image.mimeType};base64,${test.image.data}`}
                    className="max-h-40 w-auto self-start rounded-lg border border-hairline/40" />}
                </div>
              ) : <p role="alert" className="text-danger" data-connection-test="failed">{t("workComputer.guide.testFailed", { error: test.error })}</p>)}
            </>
          ) : <p className="flex items-center gap-2" data-waiting-for-mac><Loader2 size={13} className="motion-safe:animate-spin" />{t("workComputer.guide.step4.waiting")}</p>}
        </Step>
      </ol>
      <div className="flex flex-col gap-1.5 rounded-xl bg-inset p-3 text-sm text-ink-secondary">
        <p>{t("workComputer.guide.anywhere")}</p>
        <p>{t("workComputer.guide.awake")}</p>
      </div>
    </div>
  );
}
