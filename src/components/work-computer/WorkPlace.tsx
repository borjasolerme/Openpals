import { useState } from "react";
import { Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import { useWorkComputers, workChoiceLabel, workComputerState, type WorkChoice } from "@/lib/work-computers";
import { Card, LinkRow, RadioRow } from "../bot-panel/rows";
import { AddComputerGuide } from "./AddComputerGuide";

/**
 * Where a bot works, as one list: Your server, then each computer lent to it by its own name, and Add a computer.
 * A place set elsewhere (a private desktop, this computer, a bot's own cloud computer, none) shows checked so the list
 * stays true, but is not offered.
 */
export function WorkPlaceChooser({ value, onChange }: { value: WorkChoice; onChange: (choice: WorkChoice) => void }) {
  const [adding, setAdding] = useState(false);
  const { computers, refresh } = useWorkComputers(true);
  const lent = (computers ?? []).filter((computer) => computer.lent || (value.kind === "mac" && value.id === computer.id));
  if (adding) {
    return (
      <AddComputerGuide known={lent.map((computer) => computer.id)}
        onBack={() => { setAdding(false); refresh(); }}
        onUse={(id) => { setAdding(false); refresh(); onChange({ kind: "mac", id }); }} />
    );
  }
  return (
    <Card>
      <div role="radiogroup" aria-label={t("workPlace.label")} className="flex flex-col divide-y divide-line-subtle" data-work-place>
        <RadioRow data-panel-choice="server" title={t("workPlace.server.title")} hint={t("workPlace.server.hint")}
          checked={value.kind === "server"} onClick={() => onChange({ kind: "server" })} />
        {lent.map((computer) => (
          <RadioRow key={computer.id} data-panel-choice={computer.id} title={computer.name}
            hint={t(`workComputer.mac.state.${workComputerState(computer)}`)}
            checked={value.kind === "mac" && value.id === computer.id} onClick={() => onChange({ kind: "mac", id: computer.id })} />
        ))}
        {value.kind === "other" && <RadioRow data-panel-choice="other" title={workChoiceLabel(value)} checked disabled onClick={() => {}} />}
      </div>
      <LinkRow data-panel-link="add-computer" icon={Plus} onClick={() => setAdding(true)}>{t("workPlace.add")}</LinkRow>
    </Card>
  );
}
