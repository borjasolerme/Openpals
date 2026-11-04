// ＋ at the end of the rail: add a server of the person's own by pasting its pairing link.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { t } from "@/lib/i18n";

/** A server's pairing link, pasted here: main checks it and asks "Connect to <host>?" itself, then opens it. The sheet
 * stays open when the person cancels, and says so when the link isn't one. */
export function OwnServerLink({ onConnected }: { onConnected: () => void }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const pasted = link.trim();
    if (!pasted || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (await window.ogb?.workspaces?.add?.("link", pasted) !== false) onConnected();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return <form data-place-add="own-server" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 px-[30px] pb-[26px] pt-7">
    <div className="flex flex-col gap-1 pe-10">
      <h2 id="place-add-title" tabIndex={-1} className="text-[17px] font-medium leading-6 tracking-[-0.008em] text-ink outline-none! [text-wrap:balance]">{t("rail.own")}</h2>
      <p className="text-[14px] leading-5 text-ink-secondary [text-wrap:pretty]">{t("rail.pasteLede")}</p>
    </div>
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">{t("rail.paste")}
      <input data-autofocus data-own-server-link value={link} disabled={busy} onChange={(event) => { setLink(event.target.value); setFailed(false); }}
        placeholder="https://" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} aria-invalid={failed || undefined}
        className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] font-normal text-ink outline-none focus:border-accent/50" />
    </label>
    {failed && <p role="alert" className="text-[13px] text-danger">{t("rail.linkFailed")}</p>}
    <div><button type="submit" disabled={busy || !link.trim()} className="ui-button ui-button-primary inline-flex items-center gap-2">
      {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{t("rail.connect")}
    </button></div>
  </form>;
}

const FOCUSABLE = "button:not([disabled]):not([tabindex='-1']), input:not([disabled]):not([tabindex='-1']), [href], [tabindex='0']";

/** The sheet over the app: Escape and Close close it, Tab stays in it, focus goes back after. */
function RailSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = [...(sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!controls.length) return;
      event.preventDefault();
      const at = controls.indexOf(document.activeElement as HTMLElement);
      controls[at === -1 ? 0 : (at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]!.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); if (opener?.isConnected) opener.focus(); };
  }, [onClose]);
  useEffect(() => { sheet.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus(); }, []);
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={sheet} role="dialog" aria-modal="true" aria-labelledby="place-add-title" data-place-add-sheet tabIndex={-1}
      className="animate-pop-in relative max-h-full w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-2xl border border-hairline/70 bg-panel shadow-2xl outline-none">
      <button type="button" onClick={onClose} aria-label={t("common.close")} className="ui-icon-button absolute end-3.5 top-3.5 z-10"><X size={18} /></button>
      {children}
    </div>
  </div>;
}

export function PlaceAddSheet({ onClose }: { onClose: () => void }) {
  return <RailSheet onClose={onClose}><OwnServerLink onConnected={onClose} /></RailSheet>;
}
