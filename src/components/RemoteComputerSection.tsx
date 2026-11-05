import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { Laptop, Loader2, Unplug } from "lucide-react";
import { connectServer, currentPlace, disconnectServer, onPlaceChanged, placeAvailable, type BotsPlace } from "@/lib/place";
import { Card } from "./SettingsPrimitives";

const inputClass =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none";

function errorText(error: unknown): string {
  return String((error as { message?: string })?.message ?? error).replace(
    /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/,
    "",
  );
}

export function isServerPairingLink(input: string): boolean {
  const link = input.trim();
  if (!/^https:\/\//i.test(link) || /[\s\\]/.test(link)) return false;
  try {
    const url = new URL(link);
    const code = /(?:^|[#&])code=([^&]+)/.exec(url.hash)?.[1];
    return url.protocol === "https:" && !url.username && !url.password && !url.search
      && (url.pathname === "/pair" || url.pathname === "/pair/")
      && Boolean(code && decodeURIComponent(code).trim());
  } catch {
    return false;
  }
}

export function RemoteComputerSection({ hideWhenUnavailable = false }: { hideWhenUnavailable?: boolean }) {
  const available = placeAvailable();
  const [place, setPlace] = useState<BotsPlace | null>(null);
  const [serverLink, setServerLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  useEffect(() => {
    let alive = true;
    void currentPlace().then((next) => { if (alive) setPlace(next); }).catch(() => {});
    const stop = onPlaceChanged((next) => { if (alive) setPlace(next); });
    return () => { alive = false; stop(); };
  }, []);

  const act = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const connect = () => act(async () => {
    if (!isServerPairingLink(serverLink)) throw new Error(t("remote.client.server.invalidLink"));
    const result = await connectServer(serverLink.trim());
    if (!result.ok) throw new Error(result.error);
  });

  if (!available && hideWhenUnavailable) return null;
  const server = place?.kind === "server" ? place : null;

  return (
    <Card
      title={server ? t("remote.client.active") : t("remote.client.idle")}
      subtitle={t("remote.client.subtitle")}
    >
      {!available ? (
        <p className="text-[13px] text-ink-secondary">{t("remote.client.desktopOnly")}</p>
      ) : server ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg border border-success/25 bg-success/10 px-3 py-3">
            <Laptop size={18} className="mt-0.5 shrink-0 text-success" />
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-ink">{t("remote.client.connected", { name: server.label })}</div>
              <div className="mt-1 break-all text-[12px] text-ink-secondary">{server.url}</div>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(disconnectServer)}
            className="flex w-fit items-center gap-2 rounded-lg border border-danger/30 px-3 py-2 text-[13px] text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
            {t("remote.client.disconnect")}
          </button>
          {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
          <p className="text-[13px] leading-relaxed text-ink-secondary">{t("remote.client.server.hint")}</p>
          <code className="select-all rounded-lg bg-inset px-3 py-2 text-[12px] text-ink">npx openmausbot pair</code>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">
            {t("remote.client.server.pairingLink")}
            <input
              value={serverLink}
              onChange={(event) => setServerLink(event.target.value)}
              placeholder="https://bots.example.com/pair#code=XXXX-XXXX-XXXX"
              disabled={busy}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </label>
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t("remote.client.server.domainHint")}</p>
          {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
          <button
            type="submit"
            disabled={busy || !serverLink.trim()}
            className="flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Laptop size={14} />}
            {t("remote.client.server.connect")}
          </button>
        </form>
      )}
    </Card>
  );
}
