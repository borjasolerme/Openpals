import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Laptop, Plus, Server } from "lucide-react";
import { AddServerPanel } from "@/components/ServerSetup";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useThisComputerName, type BotsPlace } from "@/lib/place";
import { useServerSetup } from "@/lib/server-setup";
import { useStore } from "@/state/store";
import { ROW, ROW_LIST, RowIcon, RowStatus, RowText } from "./rows";

export type PlaceKind = BotsPlace["kind"];

/** One place the bots can live, chosen as a whole row; the place they live now says Connected. */
function PlaceOption({ kind, selected, connected, icon, title, hint, onChoose, onArrow }: {
  kind: PlaceKind;
  selected: boolean;
  connected: boolean;
  icon: ReactNode;
  title: string;
  hint?: string | null;
  onChoose: () => void;
  onArrow: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} data-place-choice={kind}
      onClick={onChoose} onKeyDown={onArrow}
      className={cn(ROW, "transition-colors hover:bg-fill-subtle focus-visible:outline-offset-[-2px]")}>
      <span aria-hidden="true" className={cn("flex size-4.5 shrink-0 items-center justify-center rounded-full border transition-colors",
        selected ? "border-ink bg-ink" : "border-hairline")}>
        {selected && <span className="size-1.5 rounded-full bg-app" />}
      </span>
      <RowIcon>{icon}</RowIcon>
      <RowText title={title} hint={hint} />
      {connected && <RowStatus tone="ok">{t("keys.connected")}</RowStatus>}
    </button>
  );
}

/** Step 1, where the bots live: this computer, or the one server this app is paired with, chosen as a radio. Add a
 * server opens the pairing link and the setup that gets one; once paired, the app opens that server's page, where its
 * row is the chosen place. `choice` is only made real by the step's Continue. */
export function ConnectStep({ place, choice, onChoose, error }: {
  place: BotsPlace;
  choice: PlaceKind;
  onChoose: (kind: PlaceKind) => void;
  error: string | null;
}) {
  const { state } = useStore();
  const server = place.kind === "server" ? place : null;
  const fetchedName = useThisComputerName(!server);
  const computerName = server ? null : state.config?.computerName?.trim() || fetchedName;
  const { progress, failure } = useServerSetup();
  const [adding, setAdding] = useState(false);
  const open = adding || Boolean(progress || failure);
  const panelId = useId();
  const group = useRef<HTMLDivElement>(null);
  const kinds: PlaceKind[] = server ? ["local", "server"] : ["local"];

  // Arrow keys move the choice, as in any radio group.
  const onArrow = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (!step || kinds.length < 2) return;
    event.preventDefault();
    const next = kinds[(kinds.indexOf(choice) + step + kinds.length) % kinds.length]!;
    onChoose(next);
    group.current?.querySelector<HTMLButtonElement>(`[data-place-choice="${next}"]`)?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className={ROW_LIST}>
        <div ref={group} role="radiogroup" aria-labelledby="welcome-title" className="flex flex-col divide-y divide-hairline/40">
          <PlaceOption kind="local" selected={choice === "local"} connected={!server} icon={<Laptop size={16} />}
            title={t("botsHome.local")} hint={computerName ?? t("botsHome.localHint")} onChoose={() => onChoose("local")} onArrow={onArrow} />
          {server && (
            <PlaceOption kind="server" selected={choice === "server"} connected icon={<Server size={16} />}
              title={server.label} hint={server.url} onChoose={() => onChoose("server")} onArrow={onArrow} />
          )}
        </div>
        <div data-add-server="">
          <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setAdding(!open)}
            className={cn(ROW, "transition-colors hover:bg-fill-subtle focus-visible:outline-offset-[-2px]")}>
            <span aria-hidden="true" className="size-4.5 shrink-0" />
            <RowIcon><Plus size={16} /></RowIcon>
            <RowText title={t("botsHome.addServer")} hint={t("botsHome.addServerHint")} />
            <ChevronDown size={16} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform duration-base", open && "rotate-180")} />
          </button>
          {open && <div id={panelId} className="px-4 pb-4 pt-1"><AddServerPanel /></div>}
        </div>
      </div>
      {server && choice === "local" && (
        <p data-leave-server="" className="text-base text-warning">{t("botsHome.leaveServerNote", { server: server.label })}</p>
      )}
      {error && <p role="alert" className="text-base text-danger">{error}</p>}
    </div>
  );
}
