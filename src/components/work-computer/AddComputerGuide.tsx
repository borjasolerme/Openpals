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

export const INSTALL_GUIDE = `${APP_REPOSITORY}#getting-started`;

interface PairingLink { code: string; url: string | null; expiresAt: number }

/** A computer new to this guide: online now, and not online when the guide opened. */
export function newlyConnected(computers: readonly WorkComputer[] | null, onlineAtOpen: ReadonlySet<string>): WorkComputer | null {
  return (computers ?? []).find((computer) => computer.online && !onlineAtOpen.has(computer.id)) ?? null;
}

/** The step the guide highlights: the furthest one reached, or "connected" once the computer shows up. */
export function guideStep({ reached, connected }: { reached: number; connected: boolean }): 1 | 2 | 3 | "connected" {
  if (connected) return "connected";
  return reached >= 3 ? 3 : reached >= 2 ? 2 : 1;
}

function Step({ number, step, title, children }: { number: 1 | 2 | 3; step: 1 | 2 | 3; title: string; children?: ReactNode }) {
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

function OnAMac() {
  const [open, setOpen] = useState(false);
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

function PairingLinkView({ link, now, onCopied }: { link: PairingLink; now: number; onCopied: () => void }) {
  const [copied, setCopied] = useState<CopyFeedback>("idle");
  const copy = (url: string) => {
    onCopied();
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

function Connected({ computer, onUse }: { computer: WorkComputer; onUse: (id: string) => void }) {
  const [test, setTest] = useState<ConnectionTest | "testing" | null>(null);
  const runTest = async () => {
    setTest("testing");
    setTest(await testWorkComputer(computer.id).catch((cause) => ({ ok: false as const, error: cause instanceof Error ? cause.message : String(cause) })));
  };
  return (
    <div className="flex flex-col gap-3 px-3.5 py-3" data-guide-connected>
      <div className="text-base font-medium text-ink">{t("workComputer.guide.step4.connected", { name: computer.name })}</div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onUse(computer.id)}>{t("workComputer.guide.use", { name: computer.name })}</Button>
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

/**
 * "Add a computer": a Mac mini, a laptop, a desktop PC or a cloud VM with a desktop. Install Openpals there, connect it
 * with a one-time pairing link made as that step opens, turn on lending there, and the guide sees it arrive by itself.
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
  const step = guideStep({ reached, connected: Boolean(connected) });
  const at = step === "connected" ? 3 : step;
  const expired = link ? link.expiresAt <= now : false;
  const reach = (value: number) => setReached((current) => Math.max(current, value));

  const makeLink = async () => {
    setMaking(true);
    setError("");
    try {
      setLink(await api<PairingLink>("/api/auth/pairing", { method: "POST", body: JSON.stringify({ scopes: ["admin", "client"], label: t("workComputer.guide.pairingLabel") }) }));
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
    <div className="flex flex-col gap-2" data-add-computer-guide>
      <Button variant="ghost" size="sm" className="gap-1.5 self-start" onClick={onBack}><ArrowLeft size={14} />{t("workComputer.back")}</Button>
      <div className="flex flex-col gap-0.5 px-1">
        <div className="text-lg font-medium text-ink">{t("workComputer.guide.title")}</div>
        <p className="text-sm text-ink-secondary [text-wrap:pretty]">{t("workComputer.guide.intro")}</p>
      </div>
      <Card>
        {connected ? <Connected computer={connected} onUse={onUse} /> : (
          <ol className="flex flex-col divide-y divide-line-subtle">
            <Step number={1} step={at} title={t("workComputer.guide.step1.title")}>
              <div className="flex flex-wrap items-center gap-2">
                <a href={INSTALL_GUIDE} target="_blank" rel="noreferrer"
                  onClick={(event) => { event.preventDefault(); void openExternalLink(INSTALL_GUIDE).catch(() => {}); reach(2); }}
                  className={buttonClass({ size: "sm", variant: at === 1 ? "primary" : "secondary" }, "gap-1.5")}>
                  {t("workComputer.guide.step1.download")}<ExternalLink size={13} />
                </a>
                {at === 1 && <Button variant="ghost" size="sm" onClick={() => reach(2)}>{t("workComputer.guide.installed")}</Button>}
              </div>
            </Step>
            <Step number={2} step={at} title={t("workComputer.guide.step2.connect")}>
              <p>{t("workComputer.guide.step2.paste")}</p>
              {link && !expired && <PairingLinkView link={link} now={now} onCopied={() => reach(3)} />}
              {making && <p className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" />{t("workComputer.guide.step2.creating")}</p>}
              {!making && (expired || error) && (
                <Button size="sm" className="self-start" onClick={() => void makeLink()}>{t("workComputer.guide.step2.again")}</Button>
              )}
              {error && <p role="alert" className="text-danger">{error}</p>}
            </Step>
            <Step number={3} step={at} title={t("workComputer.guide.step3.turnOn")}>
              <p>{t("workComputer.guide.step3.settings")}</p>
              <OnAMac />
              {at !== 1 && <p className="flex items-center gap-2" data-waiting-for-computer><Loader2 size={13} className="motion-safe:animate-spin" />{t("workComputer.guide.step4.waiting")}</p>}
            </Step>
          </ol>
        )}
      </Card>
      <p className="px-1 text-sm text-ink-secondary">{t("workComputer.guide.keepAwake")}</p>
    </div>
  );
}
