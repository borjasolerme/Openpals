import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { workPatch, type WorkChoice } from "@/lib/work-computers";
import { useStore } from "@/state/store";
import { Button } from "../ui/Button";
import { Dialog, DialogFooter, DialogPanel } from "../ui/Dialog";
import { WorkComputerPicker, WorkMoreChoices } from "./WorkComputerPicker";
import { browserProfileFor, defaultBrowserChoice, NewBotBrowserChoice, type BrowserChoice } from "./BrowserChoice";

/** "Where does this bot work?", asked when New bot is chosen, before the bot is made. */
export function NewBotWorkStep() {
  const { state, dispatch } = useStore();
  const pending = state.newBotStep;
  const boatReady = state.config?.box?.configured === true;
  const [choice, setChoice] = useState<WorkChoice>({ kind: boatReady ? "boat" : "server" });
  const [browser, setBrowser] = useState<BrowserChoice>(defaultBrowserChoice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const createRef = useRef<HTMLButtonElement>(null);
  const asking = Boolean(pending);
  useEffect(() => {
    if (!asking) return;
    setChoice({ kind: boatReady ? "boat" : "server" });
    setBrowser(defaultBrowserChoice());
    setError("");
  }, [asking, boatReady]);
  const close = () => dispatch({ type: "newBotStep", action: null });
  const create = async () => {
    if (!pending || saving) return;
    setSaving(true);
    setError("");
    try {
      const profiles = state.config?.browserProfiles ?? [];
      const browserProfile = await browserProfileFor(browser, profiles, (config) => dispatch({ type: "configStatus", config }));
      close();
      dispatch({ ...pending, work: { ...workPatch(choice), ...(browserProfile ? { browserProfile } : {}) } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.profiles.saveError"));
    } finally {
      setSaving(false);
    }
  };
  const busy = saving || state.botCreationPending;
  return (
    <Dialog open={Boolean(pending)} onClose={close} initialFocusRef={createRef} busy={busy}>
      {(panelRef) => (
        <DialogPanel ref={panelRef} aria-labelledby="new-bot-work-title" data-new-bot-work-step
          className="flex max-h-[90dvh] max-w-170 flex-col overflow-hidden p-0">
          <div className="shrink-0 px-5 pt-5">
            <h2 id="new-bot-work-title" className="text-xl font-semibold text-ink">{t("workComputer.title")}</h2>
            <p className="mt-1 text-base text-ink-secondary">{t("workComputer.subtitle")}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <WorkComputerPicker value={choice} onChange={setChoice} more={<WorkMoreChoices value={choice} onChange={setChoice} />} />
            <NewBotBrowserChoice value={browser} onChange={setBrowser} />
          </div>
          <div className="shrink-0 border-t border-hairline/40 px-5 py-3">
            {error ? <p role="alert" className="mb-2 text-sm text-danger">{error}</p> : null}
            <p className="text-sm text-ink-secondary">{t("workComputer.later")}</p>
            <DialogFooter className="mt-3">
              <Button onClick={close}>{t("common.cancel")}</Button>
              <Button ref={createRef} variant="primary" className="gap-1.5" disabled={busy} onClick={() => void create()}>
                {busy && <Loader2 size={14} className="animate-spin" />}{t("workComputer.create")}
              </Button>
            </DialogFooter>
          </div>
        </DialogPanel>
      )}
    </Dialog>
  );
}
