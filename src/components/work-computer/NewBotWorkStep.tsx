import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { sameChoice, workPatch, type WorkChoice } from "@/lib/work-computers";
import { useStore } from "@/state/store";
import { WORKS_ON_CHOICES } from "../WorksOnGrid";
import { Button } from "../ui/Button";
import { Dialog, DialogFooter, DialogPanel } from "../ui/Dialog";
import { WorkComputerPicker } from "./WorkComputerPicker";

/** The rest of "Works on" for a new bot: Auto, a private desktop, this computer, the browser only, or none. */
function MoreChoices({ value, onChange }: { value: WorkChoice; onChange: (choice: WorkChoice) => void }) {
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

/** "Where does this bot work?", asked when New bot is chosen, before the bot is made. */
export function NewBotWorkStep() {
  const { state, dispatch } = useStore();
  const pending = state.newBotStep;
  const boatReady = state.config?.box?.configured === true;
  const [choice, setChoice] = useState<WorkChoice>({ kind: boatReady ? "boat" : "server" });
  const createRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (pending) setChoice({ kind: boatReady ? "boat" : "server" }); }, [pending, boatReady]);
  const close = () => dispatch({ type: "newBotStep", action: null });
  const create = () => {
    if (!pending) return;
    close();
    dispatch({ ...pending, work: workPatch(choice) });
  };
  return (
    <Dialog open={Boolean(pending)} onClose={close} initialFocusRef={createRef} busy={state.botCreationPending}>
      {(panelRef) => (
        <DialogPanel ref={panelRef} aria-labelledby="new-bot-work-title" data-new-bot-work-step
          className="flex max-h-[90dvh] max-w-170 flex-col overflow-hidden p-0">
          <div className="shrink-0 px-5 pt-5">
            <h2 id="new-bot-work-title" className="text-xl font-semibold text-ink">{t("workComputer.title")}</h2>
            <p className="mt-1 text-base text-ink-secondary">{t("workComputer.subtitle")}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <WorkComputerPicker value={choice} onChange={setChoice} more={<MoreChoices value={choice} onChange={setChoice} />} />
          </div>
          <div className="shrink-0 border-t border-hairline/40 px-5 py-3">
            <p className="text-sm text-ink-secondary">{t("workComputer.later")}</p>
            <DialogFooter className="mt-3">
              <Button onClick={close}>{t("common.cancel")}</Button>
              <Button ref={createRef} variant="primary" className="gap-1.5" disabled={state.botCreationPending} onClick={create}>
                {state.botCreationPending && <Loader2 size={14} className="animate-spin" />}{t("workComputer.create")}
              </Button>
            </DialogFooter>
          </div>
        </DialogPanel>
      )}
    </Dialog>
  );
}
