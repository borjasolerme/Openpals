import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronDown, Copy, ExternalLink, Loader2 } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { connectServer, isServerPairingLink } from "@/lib/place";
import { INSTALL_COMMAND, serverSetupAvailable, useServerSetup, type ServerSetupProgress, type ServerSetupRequest } from "@/lib/server-setup";

const BOAT_SIGN_UP = "https://boat.dev";
const FIELD = "h-9 w-full min-w-0 rounded-lg border border-hairline/60 bg-inset px-3 text-base text-ink placeholder:text-ink-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:opacity-60";
const TEXT_INPUT = { autoCapitalize: "none", autoCorrect: "off", autoComplete: "off", spellCheck: false } as const;
const OPTION = "flex flex-col gap-2.5 rounded-lg bg-fill-subtle p-3";

/** What a refused pairing link tells the person; nothing when they declined the app's own confirmation. */
function connectErrorText(error: string): string | null {
  if (error === "cancelled") return null;
  if (error === "unreachable") return t("serverSetup.unreachable");
  return error;
}

function ExternalButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => void openExternalLink(href).catch(() => {})}
      className="inline-flex w-fit items-center gap-1 text-sm text-accent hover:underline">
      {children}<ExternalLink size={11} aria-hidden="true" />
    </button>
  );
}

/** One way the app sets up a server: its name and one line, one field, and the button that does the rest. */
function SetupOption({ kind, title, badge, hint, label, placeholder, secret = false, footer, onStart }: {
  kind: ServerSetupRequest["kind"];
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
    <form data-server-setup={kind} onSubmit={submit} className={OPTION}>
      <div className="flex flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-base font-medium leading-5 text-ink">
          {title}
          {badge && <span className="rounded-full bg-accent/12 px-2 py-px text-xs font-medium leading-4 text-accent">{badge}</span>}
        </span>
        <span className="text-sm text-ink-secondary [text-wrap:pretty]">{hint}</span>
      </div>
      <label htmlFor={id} className="sr-only">{label}</label>
      <div className="flex gap-2 max-sm:flex-col">
        <input id={id} type={secret ? "password" : "text"} value={value} onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder ?? label} {...TEXT_INPUT} className={FIELD} />
        <button type="submit" disabled={!value.trim()} className="ui-button ui-button-primary min-h-9 shrink-0 px-4">{t("serverSetup.start")}</button>
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
    <div data-server-setup-progress={progress.step} role="status" className={cn(OPTION, "flex-row items-start gap-3")}>
      <Loader2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 animate-spin text-ink-secondary" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-base font-medium leading-5 text-ink">{t(STEP_TEXT[progress.step])}</span>
        {progress.detail && <span className="truncate font-mono text-sm text-ink-secondary">{progress.detail}</span>}
        <span className="text-sm text-ink-secondary [text-wrap:pretty]">{t("serverSetup.keepOpen")}</span>
      </div>
    </div>
  );
}

/** The pairing link an installer printed: from a server set up by hand, or to connect again. */
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
    <form data-pairing-form="" className="flex flex-col gap-1.5" onSubmit={(event) => void connect(event)}>
      <label htmlFor={id} className="text-sm text-ink-secondary">{t("serverSetup.paste")}</label>
      <div className="flex gap-2 max-sm:flex-col">
        <input id={id} data-pairing-link="" value={link} onChange={(event) => { setLink(event.target.value); setError(null); }}
          placeholder="https://…/pair#code=…" disabled={busy} {...TEXT_INPUT} className={FIELD} />
        <button type="submit" disabled={busy || !link.trim()} className="ui-button ui-button-primary min-h-9 shrink-0 px-4">
          {busy && <Loader2 size={14} aria-hidden="true" className="animate-spin" />}
          {t("serverSetup.connect")}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  );
}

/** The installer as one line to run on any Ubuntu or Debian server, with a copy button. */
function InstallCommand() {
  const { state, copy } = useCopyFeedback(INSTALL_COMMAND);
  return (
    <div data-install-command="" className="flex flex-col gap-1.5">
      <p className="text-sm text-ink-secondary">{t("serverSetup.runCommand")}</p>
      <div className="flex h-9 items-center gap-1 rounded-lg border border-hairline/60 bg-inset pl-3 pr-1">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm leading-9 text-ink [scrollbar-width:none]">{INSTALL_COMMAND}</code>
        <button type="button" onClick={copy} aria-label={t("engineSetup.copy")} title={t("engineSetup.copy")}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-fill hover:text-ink">
          {state === "copied" ? <Check size={14} aria-hidden="true" className="text-success" /> : <Copy size={14} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/** Adding the one always-on server the bots live on: its pairing link, or, under "Need a pairing link?", the setup the
 * desktop app does from a Boat API key or an own server's address, and the installer to run by hand. While a setup runs,
 * where it is. Shared by the first run and Settings. */
export function AddServerPanel() {
  const { progress, failure, start } = useServerSetup();
  const canSetUp = serverSetupAvailable();
  const [help, setHelp] = useState(false);
  const helpId = useId();
  if (progress) return <div data-server-setup-flow=""><SetupProgress progress={progress} /></div>;
  const open = help || Boolean(failure);
  return (
    <div data-server-setup-flow="" className="flex flex-col gap-3 text-left">
      <PairingLinkForm />
      <button type="button" data-pairing-help="" aria-expanded={open} aria-controls={helpId} onClick={() => setHelp(!open)}
        className="flex w-fit items-center gap-1 rounded text-base text-ink-secondary transition-colors hover:text-ink">
        {t("serverSetup.needLink")}
        <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform duration-base", open && "rotate-180")} />
      </button>
      {open && (
        <div id={helpId} className="flex flex-col gap-2.5">
          {canSetUp && (
            <>
              <p className="text-sm text-ink-secondary">{t("serverSetup.intro")}</p>
              <SetupOption kind="boat" title={t("serverSetup.boat.title")} badge={t("serverSetup.recommended")}
                hint={t("serverSetup.boat.hint")} label={t("serverSetup.boat.key")} secret
                footer={<ExternalButton href={BOAT_SIGN_UP}>{t("serverSetup.boat.getKey")}</ExternalButton>}
                onStart={(key) => void start({ kind: "boat", key })} />
              <SetupOption kind="ssh" title={t("serverSetup.own.title")} hint={t("serverSetup.own.hint")}
                label={t("serverSetup.own.address")} placeholder="root@203.0.113.7"
                onStart={(address) => void start({ kind: "ssh", address })} />
            </>
          )}
          {failure && (
            <div role="alert" className="flex flex-col gap-2 text-sm text-danger">
              <p>{failure.text}</p>
              {failure.output && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-inset p-3 font-mono text-sm text-ink-secondary">{failure.output}</pre>}
            </div>
          )}
          <InstallCommand />
        </div>
      )}
    </div>
  );
}
