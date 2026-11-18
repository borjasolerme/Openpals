import { useState } from "react";
import { Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import { useThisComputerName } from "@/lib/place";
import { forgetWorkComputer, renameWorkComputer, serverHost, useWorkComputers, workChoiceLabel, workComputerState, type WorkChoice, type WorkComputer } from "@/lib/work-computers";
import { Card, LabelAction, LinkRow, RadioRow, TrashButton, rowCls } from "../bot-panel/rows";
import { ConfirmDialog } from "../ConfirmDialog";
import { Input } from "../ui/Input";
import { AddComputerGuide } from "./AddComputerGuide";

/**
 * Where a bot works, as one list: Your server, then each computer lent to it by its own name, and Add a computer.
 * A place set elsewhere (a private desktop, this computer, a bot's own cloud computer, none) shows checked so the list
 * stays true, but is not offered.
 */
/** One lent computer while editing: its name, saved when the field is left or Enter pressed, and Remove. */
function EditableComputer({ computer, onRename, onRemove }: { computer: WorkComputer; onRename: (name: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(computer.name);
  const save = () => { const next = name.trim(); if (next && next !== computer.name) onRename(next); else setName(computer.name); };
  return (
    <div className={rowCls} data-work-place-edit={computer.id}>
      <div className="min-w-0 flex-1">
        <Input aria-label={t("workPlace.nameLabel", { name: computer.name })} value={name} maxLength={120} className="w-full"
          onChange={(event) => setName(event.target.value)} onBlur={save}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setName(computer.name); event.currentTarget.blur(); } }} />
        <div className="mt-1 text-base text-ink-secondary">{t(`workComputer.mac.state.${workComputerState(computer)}`)}</div>
      </div>
      <TrashButton data-panel-action="remove-computer" label={t("workPlace.remove", { name: computer.name })} onClick={onRemove} />
    </div>
  );
}

export function WorkPlaceChooser({ value, onChange }: { value: WorkChoice; onChange: (choice: WorkChoice) => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<WorkComputer | null>(null);
  const [error, setError] = useState("");
  const { computers, refresh } = useWorkComputers(true);
  const serverName = useThisComputerName(true);
  const host = serverHost();
  const serverHint = serverName ? t("workPlace.server.livesOn", { place: host ? `${serverName} (${host})` : serverName }) : t("workPlace.server.hint");
  const lent = (computers ?? []).filter((computer) => computer.lent || (value.kind === "mac" && value.id === computer.id));
  const failed = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  const rename = (id: string, name: string) => { setError(""); void renameWorkComputer(id, name).then(refresh, failed); };
  const remove = (computer: WorkComputer) => { setRemoving(null); setError(""); void forgetWorkComputer(computer.id).then(refresh, failed); };
  if (adding) {
    return (
      <AddComputerGuide known={lent.map((computer) => computer.id)}
        onBack={() => { setAdding(false); refresh(); }}
        onUse={(id) => { setAdding(false); refresh(); onChange({ kind: "mac", id }); }} />
    );
  }
  return (
    <Card label={t("workPlace.label")} action={lent.length > 0 && (
      <LabelAction data-panel-action="edit-computers" onClick={() => setEditing((on) => !on)}>{t(editing ? "workPlace.done" : "workPlace.edit")}</LabelAction>
    )}>
      {editing ? (
        <div className="flex flex-col divide-y divide-line-subtle">
          {lent.map((computer) => (
            <EditableComputer key={computer.id} computer={computer} onRename={(name) => rename(computer.id, name)} onRemove={() => setRemoving(computer)} />
          ))}
        </div>
      ) : <div role="radiogroup" aria-label={t("workPlace.label")} className="flex flex-col divide-y divide-line-subtle" data-work-place>
        <RadioRow data-panel-choice="server" title={t("workPlace.server.title")} hint={serverHint}
          checked={value.kind === "server"} onClick={() => onChange({ kind: "server" })} />
        {lent.map((computer) => (
          <RadioRow key={computer.id} data-panel-choice={computer.id} title={computer.name}
            hint={t(`workComputer.mac.state.${workComputerState(computer)}`)}
            checked={value.kind === "mac" && value.id === computer.id} onClick={() => onChange({ kind: "mac", id: computer.id })} />
        ))}
        {value.kind === "other" && <RadioRow data-panel-choice="other" title={workChoiceLabel(value)} checked disabled onClick={() => {}} />}
      </div>}
      {error ? <p role="alert" className="px-3.5 py-2 text-base text-danger">{error}</p> : null}
      <ConfirmDialog open={removing !== null} title={t("workPlace.removeTitle", { name: removing?.name ?? "" })}
        body={t("workPlace.removeBody")} confirmLabel={t("workPlace.removeConfirm")} cancelLabel={t("common.cancel")}
        onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) remove(removing); }} />
      <LinkRow data-panel-link="add-computer" icon={Plus} onClick={() => setAdding(true)}>{t("workPlace.add")}</LinkRow>
    </Card>
  );
}
