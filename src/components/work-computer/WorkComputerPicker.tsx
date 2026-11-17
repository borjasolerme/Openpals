import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Cloud, Laptop, Plus, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { sameChoice, useWorkComputers, type WorkChoice } from "@/lib/work-computers";
import { WORKS_ON_CHOICES } from "../WorksOnGrid";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { AddMacGuide } from "./AddMacGuide";
import { BoatKeyPanel } from "./BoatKeyPanel";
import { WorkComputerBadge } from "./WorkComputerBadge";

type View = "cards" | "boat-key" | "mac-guide";

/** The rest of "Works on": Auto, a private desktop, this computer, or none. */
export function WorkMoreChoices({ value, onChange }: { value: WorkChoice; onChange: (choice: WorkChoice) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("workComputer.more")}>
      {WORKS_ON_CHOICES.filter(([mode]) => mode !== "cloud" && mode !== "browser").map(([mode, labelKey, descriptionKey, Icon]) => {
        const choice: WorkChoice = { kind: "other", computer: mode };
        const selected = sameChoice(value, choice);
        return (
          <button key={mode ?? "auto"} type="button" aria-pressed={selected} onClick={() => onChange(choice)}
            className={cn("min-w-0 rounded-lg border px-2.5 py-2.5 text-left", selected ? "border-accent/60 bg-accent/10" : "border-hairline/50 hover:bg-control/60")}>
            <span className="flex items-center gap-2 text-sm font-medium text-ink"><Icon size={14} className="shrink-0 text-ink-secondary" />{t(labelKey)}</span>
            <span className="mt-1 block text-xs leading-4 text-ink-secondary">{t(descriptionKey)}</span>
          </button>
        );
      })}
    </div>
  );
}


function ChoiceCard({ icon: Icon, title, description, note, selected, onClick, testId }: {
  icon: LucideIcon; title: string; description: string; note?: ReactNode; selected: boolean; onClick: () => void; testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        selected ? "border-accent/60 bg-accent/10 text-ink" : "border-hairline/50 bg-panel/30 text-ink-secondary hover:border-accent/40 hover:bg-control/60",
      )}
    >
      <span className="flex items-center gap-2 text-base font-medium text-ink">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", selected ? "bg-accent text-white" : "bg-fill text-ink-secondary")}>
          {selected ? <Check size={15} /> : <Icon size={15} />}
        </span>
        <span className="min-w-0">{title}</span>
      </span>
      <span className="text-sm leading-5 text-ink-secondary">{description}</span>
      {note && <span className="mt-auto flex min-w-0 max-w-full self-start pt-1">{note}</span>}
    </button>
  );
}

/**
 * Where a bot works, in three plain choices: a Boat cloud computer, a Mac of the owner's lent to this server, or the
 * server itself. `more` is everything else (Auto, a private desktop, a VPS), shown under More options.
 */
export function WorkComputerPicker({ value, onChange, more, live = true }: {
  value: WorkChoice;
  onChange: (choice: WorkChoice) => void;
  more?: ReactNode;
  /** Reads the lent computers again every few seconds while shown. */
  live?: boolean;
}) {
  const { state } = useStore();
  const [view, setView] = useState<View>("cards");
  const [macsOpen, setMacsOpen] = useState(value.kind === "mac");
  const [moreOpen, setMoreOpen] = useState(value.kind === "other");
  const { computers, refresh } = useWorkComputers(live);
  const boatReady = state.config?.box?.configured === true;
  const macs = (computers ?? []).filter((computer) => computer.lent || (value.kind === "mac" && value.id === computer.id));
  const chosenMac = value.kind === "mac" ? macs.find((computer) => computer.id === value.id) : undefined;

  if (view === "boat-key") {
    return <BoatKeyPanel onBack={() => setView("cards")} onReady={() => { setView("cards"); onChange({ kind: "boat" }); }} />;
  }
  if (view === "mac-guide") {
    return <AddMacGuide known={macs.map((computer) => computer.id)} onBack={() => { setView("cards"); refresh(); }}
      onUse={(id) => { setView("cards"); setMacsOpen(true); refresh(); onChange({ kind: "mac", id }); }} />;
  }
  return (
    <div className="@container flex flex-col gap-3" data-work-computer-picker>
      <div role="group" aria-label={t("workComputer.title")} className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
        <ChoiceCard testId="work-boat" icon={Cloud} title={t("workComputer.boat.title")} description={t("workComputer.boat.desc")}
          selected={value.kind === "boat"}
          note={<Badge tone={boatReady ? "success" : "outline"}>{t(boatReady ? "workComputer.boat.ready" : "workComputer.boat.needsKey")}</Badge>}
          onClick={() => (boatReady ? onChange({ kind: "boat" }) : setView("boat-key"))} />
        <ChoiceCard testId="work-mac" icon={Laptop} title={t("workComputer.mac.title")} description={t("workComputer.mac.desc")}
          selected={value.kind === "mac"}
          note={chosenMac ? <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink"><span className="truncate">{chosenMac.name}</span><WorkComputerBadge computer={chosenMac} /></span>
            : <Badge tone="outline">{macs.length ? t("workComputer.mac.count", { count: macs.length }) : t("workComputer.mac.setUp")}</Badge>}
          onClick={() => (macs.length ? setMacsOpen((open) => !open || value.kind !== "mac") : setView("mac-guide"))} />
        <ChoiceCard testId="work-server" icon={Server} title={t("workComputer.server.title")} description={t("workComputer.server.desc")}
          selected={value.kind === "server"} note={<Badge tone="success">{t("workComputer.boat.ready")}</Badge>}
          onClick={() => onChange({ kind: "server" })} />
      </div>
      {(macsOpen || value.kind === "mac") && macs.length > 0 && (
        <div className="rounded-xl bg-inset p-2" data-work-macs>
          <div role="radiogroup" aria-label={t("workComputer.mac.title")} className="flex flex-col">
            {macs.map((computer) => {
              const selected = value.kind === "mac" && value.id === computer.id;
              return (
                <button key={computer.id} type="button" role="radio" aria-checked={selected} onClick={() => onChange({ kind: "mac", id: computer.id })}
                  className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left", selected ? "bg-accent/10" : "hover:bg-control/60")}>
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-accent bg-accent" : "border-hairline")}>
                    {selected && <span className="size-1.5 rounded-full bg-white" />}
                  </span>
                  <Laptop size={16} className="shrink-0 text-ink-secondary" />
                  <span className="min-w-0 flex-1 truncate text-base text-ink">{computer.name}</span>
                  <WorkComputerBadge computer={computer} />
                </button>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" className="mt-1 gap-1.5" onClick={() => setView("mac-guide")}><Plus size={14} />{t("workComputer.mac.add")}</Button>
        </div>
      )}
      {macs.length === 0 && value.kind !== "mac" && macsOpen && (
        <p className="text-sm text-ink-secondary">{t("workComputer.mac.none")}</p>
      )}
      {more && (
        <div>
          <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}
            className="flex items-center gap-1 text-sm text-ink-secondary hover:text-ink">
            <ChevronDown size={14} className={cn("transition-transform", moreOpen && "rotate-180")} />
            {t(moreOpen ? "workComputer.fewer" : "workComputer.more")}
          </button>
          {moreOpen && <div className="mt-2">{more}</div>}
        </div>
      )}
    </div>
  );
}
