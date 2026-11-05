import { useId, useState, type ReactNode } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { connectServer, isServerPairingLink } from "@/lib/place";
import { CommandLine } from "./SettingsPrimitives";

const INSTALLER_URL = "https://raw.githubusercontent.com/borjasolerme/Openpals/main/scripts/install-server.sh";
const BOAT_DOCS = "https://boat.dev/docs";
const HTTPS_GUIDE = "https://github.com/borjasolerme/Openpals/blob/main/docs/deploy-vps.md";
const SERVER_PORT = 8799;
const FIELD = "h-9 w-full min-w-0 rounded-lg border border-hairline/60 bg-inset px-3 text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:opacity-60";

type Host = "boat" | "vps";

export function installCommand(address: string): string {
  const origin = address.trim().replace(/\/+$/, "") || "https://your-address";
  return `curl -fsSL ${INSTALLER_URL} | bash -s -- --public-url ${origin}`;
}

export function boatCommands(machineId: string) {
  const id = machineId.trim() || "<id>";
  return {
    create: "boat new openpals",
    keepOn: `boat extend ${id} --no-auto-stop`,
    address: `boat host ${id} ${SERVER_PORT} --public --localhost`,
    terminal: `boat ssh ${id}`,
  };
}

/** What a refused connection tells the person; nothing when they declined the app's own confirmation. */
export function connectErrorText(error: string): string | null {
  if (error === "cancelled") return null;
  if (error === "unreachable") return t("serverGuide.unreachable");
  return error;
}

function Step({ n, text, children }: { n: number; text: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[11px] font-medium tabular-nums text-ink-secondary">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-[13px] leading-[18px] text-ink">
        <span>{text}</span>
        {children}
      </div>
    </li>
  );
}

function Command({ command }: { command: string }) {
  return <CommandLine command={command} copyLabel={t("engineSetup.copyCommand")} wrap />;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => void openExternalLink(href).catch(() => {})}
      className="inline-flex w-fit items-center gap-1 text-[13px] text-accent hover:underline">
      {children}<ExternalLink size={12} aria-hidden="true" />
    </button>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] text-ink-secondary">{label}</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} className={FIELD} />
    </div>
  );
}

function BoatSteps({ address, onAddress }: { address: string; onAddress: (value: string) => void }) {
  const [machine, setMachine] = useState("");
  const boat = boatCommands(machine);
  return (
    <ol className="flex flex-col gap-4">
      <Step n={1} text={t("serverGuide.boat.account")}><Link href={BOAT_DOCS}>{t("serverGuide.boat.docs")}</Link></Step>
      <Step n={2} text={t("serverGuide.boat.create")}>
        <Command command={boat.create} />
        <Field label={t("serverGuide.boat.machineId")} value={machine} onChange={setMachine} placeholder="<id>" />
      </Step>
      <Step n={3} text={t("serverGuide.boat.keepOn")}><Command command={boat.keepOn} /></Step>
      <Step n={4} text={t("serverGuide.boat.address")}>
        <Command command={boat.address} />
        <Field label={t("serverGuide.address")} value={address} onChange={onAddress} placeholder="https://…" />
      </Step>
      <Step n={5} text={t("serverGuide.boat.terminal")}><Command command={boat.terminal} /></Step>
      <Step n={6} text={t("serverGuide.install")}><Command command={installCommand(address)} /></Step>
    </ol>
  );
}

function VpsSteps({ address, onAddress }: { address: string; onAddress: (value: string) => void }) {
  return (
    <ol className="flex flex-col gap-4">
      <Step n={1} text={t("serverGuide.vps.server")} />
      <Step n={2} text={t("serverGuide.vps.address", { port: SERVER_PORT })}>
        <Link href={HTTPS_GUIDE}>{t("serverGuide.vps.httpsGuide")}</Link>
        <Field label={t("serverGuide.address")} value={address} onChange={onAddress} placeholder="https://…" />
      </Step>
      <Step n={3} text={t("serverGuide.vps.terminal")}><Command command="ssh root@your-server" /></Step>
      <Step n={4} text={t("serverGuide.install")}><Command command={installCommand(address)} /></Step>
    </ol>
  );
}

/** Setting up an always-on server and pairing this app with it: a guide per kind of server, then the pairing link the
 * installer prints. `onBack` leaves the guide for this computer. */
export function ServerGuide({ onBack, backLabel }: { onBack?: () => void; backLabel?: string }) {
  const [host, setHost] = useState<Host>("boat");
  const [address, setAddress] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkId = useId();

  const connect = async () => {
    if (busy) return;
    if (!isServerPairingLink(link)) return setError(t("serverGuide.invalidLink"));
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
    <div data-server-guide={host} className="flex flex-col gap-5 text-left">
      <div role="tablist" aria-label={t("serverGuide.choose")} className="flex gap-1 rounded-full bg-ink/[0.05] p-1">
        {(["boat", "vps"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={host === id} onClick={() => setHost(id)}
            className={cn("min-h-8 flex-1 rounded-full px-3 py-1 text-[13px] leading-4 transition-colors",
              host === id ? "bg-menu text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-ink-secondary hover:text-ink")}>
            {t(id === "boat" ? "serverGuide.boat.tab" : "serverGuide.vps.tab")}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {host === "boat" ? <BoatSteps address={address} onAddress={setAddress} /> : <VpsSteps address={address} onAddress={setAddress} />}
      </div>
      <form className="flex flex-col gap-2 border-t border-hairline/40 pt-4" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
        <label htmlFor={linkId} className="text-[13px] font-medium text-ink">{t("serverGuide.paste")}</label>
        <div className="flex gap-2 max-sm:flex-col">
          <input id={linkId} data-pairing-link="" value={link} onChange={(event) => { setLink(event.target.value); setError(null); }}
            placeholder="https://…/pair#code=…" disabled={busy}
            autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} className={FIELD} />
          <button type="submit" disabled={busy || !link.trim()} className="ui-button ui-button-primary min-h-9 shrink-0 px-4">
            {busy && <Loader2 size={14} aria-hidden="true" className="animate-spin" />}
            {t("serverGuide.connect")}
          </button>
        </div>
        {error && <p role="alert" className="text-[13px] leading-[18px] text-danger">{error}</p>}
      </form>
      {onBack && (
        <button type="button" onClick={onBack} className="w-fit text-[13px] text-ink-secondary transition-colors hover:text-ink">
          {backLabel ?? t("serverGuide.useLocal")}
        </button>
      )}
    </div>
  );
}
