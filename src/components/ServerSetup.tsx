import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Cloud, ExternalLink, Loader2, Server } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { connectServer, isServerPairingLink } from "@/lib/place";
import { serverSetupAvailable, useServerSetup, type ServerSetupProgress, type ServerSetupRequest } from "@/lib/server-setup";

const BOAT_SIGN_UP = "https://boat.dev";
const FIELD = "h-9 w-full min-w-0 rounded-lg border border-hairline/60 bg-inset px-3 text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:opacity-60";
const TEXT_INPUT = { autoCapitalize: "none", autoCorrect: "off", autoComplete: "off", spellCheck: false } as const;

/** What a refused pairing link tells the person; nothing when they declined the app's own confirmation. */
function connectErrorText(error: string): string | null {
  if (error === "cancelled") return null;
  if (error === "unreachable") return t("serverSetup.unreachable");
  return error;
}

function ExternalButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => void openExternalLink(href).catch(() => {})}
      className="inline-flex w-fit items-center gap-1 text-[13px] text-accent hover:underline">
      {children}<ExternalLink size={12} aria-hidden="true" />
    </button>
  );
}

/** One way to get a server: what it is, one field, and the button that does the rest. */
function SetupCard({ kind, icon, title, badge, hint, label, placeholder, secret = false, footer, onStart }: {
  kind: ServerSetupRequest["kind"];
  icon: ReactNode;
  title: string;
  badge?: string;
  hint: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  footer?: ReactNode;
  onStart: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onStart(value.trim());
  };
  return (
    <form data-server-setup={kind} onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-hairline/40 bg-card px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.05] text-ink-secondary">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium leading-5 text-ink">
            {title}
            {badge && <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-medium leading-4 text-accent">{badge}</span>}
          </span>
          <span className="text-[13px] leading-[18px] text-ink-secondary">{hint}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-[12px] text-ink-secondary">{label}</label>
        <div className="flex gap-2 max-sm:flex-col">
          <input id={id} type={secret ? "password" : "text"} value={value} onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder} {...TEXT_INPUT} className={FIELD} />
          <button type="submit" disabled={!value.trim()} className="ui-button ui-button-primary min-h-9 shrink-0 px-4">{t("serverSetup.start")}</button>
        </div>
      </div>
      {footer}
    </form>
  );
}

const STEP_TEXT = {
  creating: "serverSetup.creating",
  installing: "serverSetup.installing",
  connecting: "serverSetup.connecting",
} as const satisfies Record<ServerSetupProgress["step"], string>;

function SetupProgress({ progress }: { progress: ServerSetupProgress }) {
  return (
    <div data-server-setup-progress={progress.step} role="status" className="flex items-start gap-3 rounded-2xl border border-hairline/40 bg-card px-4 py-4">
      <Loader2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 animate-spin text-ink-secondary" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[14px] font-medium leading-5 text-ink">{t(STEP_TEXT[progress.step])}</span>
        {progress.detail && <span className="truncate font-mono text-[12px] leading-4 text-ink-secondary">{progress.detail}</span>}
        <span className="text-[13px] leading-[18px] text-ink-secondary">{t("serverSetup.keepOpen")}</span>
      </div>
    </div>
  );
}

/** The pairing link an installer printed, pasted by hand: for a server set up some other way, or to connect again. */
function PairingLinkForm() {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!isServerPairingLink(link)) return setError(t("serverSetup.invalidLink"));
    setBusy(true);
    setError(null);
    try {
      const result = await connectServer(link.trim());
      if (!result.ok) setError(connectErrorText(result.error));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-pairing-form="" className="flex flex-col gap-2" onSubmit={(event) => void connect(event)}>
      <label htmlFor={id} className="text-[13px] text-ink">{t("serverSetup.paste")}</label>
      <div className="flex gap-2 max-sm:flex-col">
        <input id={id} data-pairing-link="" value={link} onChange={(event) => { setLink(event.target.value); setError(null); }}
          placeholder="https://…/pair#code=…" disabled={busy} {...TEXT_INPUT} className={FIELD} />
        <button type="submit" disabled={busy || !link.trim()} className="ui-button min-h-9 shrink-0 px-4">
          {busy && <Loader2 size={14} aria-hidden="true" className="animate-spin" />}
          {t("serverSetup.connect")}
        </button>
      </div>
      {error && <p role="alert" className="text-[13px] leading-[18px] text-danger">{error}</p>}
    </form>
  );
}

/** Setting up an always-on server for the person: a Boat API key or their own server's address, and one button; the
 * desktop app does the rest and switches to it. A pairing link still connects one set up some other way. `onBack`
 * leaves for this computer. */
export function ServerSetup({ onBack, backLabel }: { onBack?: () => void; backLabel?: string }) {
  const { progress, failure, start } = useServerSetup();
  const canSetUp = serverSetupAvailable();
  return (
    <div data-server-setup-flow="" className="flex flex-col gap-4 text-left">
      {progress ? <SetupProgress progress={progress} /> : canSetUp && (
        <>
          <SetupCard kind="boat" icon={<Cloud size={18} />} title={t("serverSetup.boat.title")} badge={t("serverSetup.recommended")}
            hint={t("serverSetup.boat.hint")} label={t("serverSetup.boat.key")} secret
            footer={<ExternalButton href={BOAT_SIGN_UP}>{t("serverSetup.boat.getKey")}</ExternalButton>}
            onStart={(key) => void start({ kind: "boat", key })} />
          <SetupCard kind="ssh" icon={<Server size={18} />} title={t("serverSetup.own.title")}
            hint={t("serverSetup.own.hint")} label={t("serverSetup.own.address")} placeholder="root@203.0.113.7"
            onStart={(address) => void start({ kind: "ssh", address })} />
        </>
      )}
      {failure && !progress && (
        <div role="alert" className="flex flex-col gap-2 text-[13px] leading-[18px] text-danger">
          <p>{failure.text}</p>
          {failure.output && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-inset p-3 font-mono text-[12px] leading-4 text-ink-secondary">{failure.output}</pre>}
        </div>
      )}
      {!progress && (canSetUp ? (
        <details className="group">
          <summary className="w-fit cursor-pointer text-[13px] text-ink-secondary transition-colors hover:text-ink">{t("serverSetup.havePairingLink")}</summary>
          <div className="mt-3"><PairingLinkForm /></div>
        </details>
      ) : <PairingLinkForm />)}
      {onBack && !progress && (
        <button type="button" onClick={onBack} className="w-fit text-[13px] text-ink-secondary transition-colors hover:text-ink">
          {backLabel ?? t("serverSetup.useLocal")}
        </button>
      )}
    </div>
  );
}
