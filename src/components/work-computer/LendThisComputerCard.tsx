import { useEffect, useState, type FormEvent } from "react";
import { Folder, Plus, Server, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { isLendLink, lendingBridge, lendingPhase, needsMacPermissions, type LendingPhase, type LendingState, type LendingTarget } from "@/lib/lending";
import { Switch } from "../SettingsPrimitives";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";

const PHASE_TONE: Record<LendingPhase, BadgeTone> = { off: "outline", paused: "warning", online: "success", connecting: "neutral", problem: "danger" };

function problemLine(target: LendingTarget, device: LendingState["device"]): string | null {
  switch (target.problem) {
    case "unsupported": return t("lending.problem.unsupported");
    case "signed-out": return t("lending.problem.signedOut");
    case "unreachable": return t("lending.problem.unreachable", { device });
    case "refused": return t("lending.problem.refused", { device });
    default: return null;
  }
}

type Run = (action: () => Promise<LendingState>) => void;

function ScreenRow({ state, run }: { state: LendingState; run: Run }) {
  const bridge = lendingBridge()!;
  const screen = state.screen;
  const permissions = needsMacPermissions(state);
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-inset px-3 py-2.5" data-lending-screen={screen?.reason ?? (screen?.ready ? "ready" : "unknown")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base text-ink">{t("lending.screen.title")}</div>
          <div className="text-sm text-ink-secondary">
            {screen?.ready ? t("lending.screen.ready") : permissions ? t("lending.screen.permissions") : t("lending.screen.notReady", { device: state.device })}
          </div>
        </div>
        <Switch checked={state.lendsScreen} aria-label={t("lending.screen.title")} onClick={() => run(() => bridge.setScreen(!state.lendsScreen))} />
      </div>
      {permissions && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => run(() => bridge.allowScreen())}>{t("lending.screen.allow")}</Button>
          <Button size="sm" onClick={() => run(() => bridge.openPrivacy("accessibility"))}>{t("lending.screen.openAccessibility")}</Button>
          <Button size="sm" onClick={() => run(() => bridge.openPrivacy("screen"))}>{t("lending.screen.openRecording")}</Button>
        </div>
      )}
      {!screen?.ready && !permissions && screen?.fix === "start" && (
        <Button size="sm" className="self-start" onClick={() => run(() => bridge.allowScreen())}>{t("lending.screen.start")}</Button>
      )}
    </div>
  );
}

/** One server this computer is lent to: its name, where it stands, Pause or Resume, and Remove. */
function TargetRow({ target, state, run }: { target: LendingTarget; state: LendingState; run: Run }) {
  const bridge = lendingBridge()!;
  const phase = lendingPhase(target);
  const problem = phase === "problem" ? problemLine(target, state.device) : null;
  return (
    <li className="flex flex-col gap-1 py-2" data-lending-target={target.id} data-lending-phase={phase}>
      <div className="flex min-h-8 items-center gap-2">
        <Server size={14} className="shrink-0 text-ink-secondary" />
        <span className="min-w-0 flex-1 truncate text-base text-ink">{target.serverName}</span>
        <Badge tone={PHASE_TONE[phase]}>{t(`lending.state.${phase}`)}</Badge>
        {state.on && (target.paused
          ? <Button size="sm" onClick={() => run(() => bridge.resumeTarget(target.id))}>{t("lending.resume")}</Button>
          : <Button size="sm" onClick={() => run(() => bridge.pauseTarget(target.id))}>{t("lending.pause")}</Button>)}
        <Button size="sm" variant="ghost" aria-label={t("lending.remove", { server: target.serverName })} onClick={() => run(() => bridge.removeTarget(target.id))}><X size={13} /></Button>
      </div>
      {problem && <p className="text-sm text-warning" role="status">{problem}</p>}
    </li>
  );
}

/** Paste the link from a server's "Add a computer": main asks once, then this computer is lent to that server. */
function AddServerForm({ run }: { run: Run }) {
  const bridge = lendingBridge()!;
  const [link, setLink] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isLendLink(link)) { setInvalid(true); return; }
    run(() => bridge.addLink(link.trim()).then((next) => { setLink(""); return next; }));
  };
  return (
    <form className="flex flex-col gap-1.5" onSubmit={submit} data-lending-add>
      <label className="text-sm text-ink-secondary" htmlFor="lending-link">{t("lending.addLink")}</label>
      <div className="flex gap-2">
        <Input id="lending-link" value={link} placeholder="https://…/pair#code=…&lend=1" onChange={(event) => { setLink(event.target.value); setInvalid(false); }} className="min-w-0 flex-1" />
        <Button type="submit" variant="primary" disabled={!link.trim()}>{t("lending.add")}</Button>
      </div>
      {invalid && <p role="alert" className="text-sm text-danger">{t("lending.notALendLink")}</p>}
    </form>
  );
}

/** "Let bots use this computer", in Settings → Computer: the servers it is lent to, and what they may use here. */
export function LendThisComputerCard() {
  const bridge = lendingBridge();
  const [state, setState] = useState<LendingState | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.state().then((next) => { if (alive) { setState(next); setName(next.name); } }).catch(() => {});
    const off = bridge.onChanged((summary) => setState((current) => (current ? { ...current, ...summary } : current)));
    return () => { alive = false; off(); };
  }, [bridge]);
  if (!bridge || !state) return null;
  const run: Run = (action) => {
    setError("");
    void action().then((next) => setState(next), (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const device = state.device;
  const lent = state.targets.length > 0;
  return (
    <div data-lend-this-computer data-lending-phase={state.on ? state.state : "off"}>
      <Card title={t("lending.title", { device })} subtitle={t("lending.subtitle", { device })}>
        <div className="flex flex-col gap-3">
          {lent && (
            <ul className="flex flex-col divide-y divide-line-subtle" aria-label={t("lending.servers")}>
              {state.targets.map((target) => <TargetRow key={target.id} target={target} state={state} run={run} />)}
            </ul>
          )}
          <AddServerForm run={run} />
          {lent && (
            <div className="flex flex-wrap items-center gap-2">
              {state.busy && <Badge tone="accent">{t("lending.inUse", { device })}</Badge>}
              <span className="flex-1" />
              {state.on
                ? <Button variant="danger" onClick={() => run(() => bridge.turnOff())}>{t("lending.turnOff")}</Button>
                : <Button variant="primary" onClick={() => run(() => bridge.turnOn())}>{t("lending.turnOn")}</Button>}
            </div>
          )}
          {lent && <>
            <form className="flex flex-col gap-1.5" onSubmit={(event) => { event.preventDefault(); run(() => bridge.rename(name)); }}>
              <label className="text-sm text-ink-secondary" htmlFor="lending-name">{t("lending.name")}</label>
              <div className="flex gap-2">
                <Input id="lending-name" value={name} placeholder={state.defaultName} maxLength={120} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1" />
                {name.trim() !== state.name && <Button type="submit">{t("lending.saveName")}</Button>}
              </div>
            </form>
            <ScreenRow state={state} run={run} />
            <div className="flex flex-col gap-2 rounded-lg bg-inset px-3 py-2.5">
              <div className="text-base text-ink">{t("lending.folders.title")}</div>
              {state.folders.length === 0 && <div className="text-sm text-ink-secondary">{t("lending.folders.none")}</div>}
              {state.folders.map((folder) => (
                <div key={folder.id} className="flex min-h-8 items-center gap-2">
                  <Folder size={14} className="shrink-0 text-ink-secondary" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{folder.name}</span>
                  <Badge tone="outline">{t(folder.write ? "lending.folders.readWrite" : "lending.folders.readOnly")}</Badge>
                  <Button size="sm" variant="ghost" aria-label={t("lending.folders.remove", { name: folder.name })} onClick={() => run(() => bridge.removeFolder(folder.id))}><X size={13} /></Button>
                </div>
              ))}
              <Button size="sm" className="gap-1.5 self-start" onClick={() => run(() => bridge.addFolder())}><Plus size={13} />{t("lending.folders.add")}</Button>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-base text-ink">{t("lending.terminal.title")}</div>
                <div className="text-sm text-ink-secondary">{t("lending.terminal.desc")}</div>
              </div>
              <Switch checked={state.terminal} aria-label={t("lending.terminal.title")} onClick={() => run(() => bridge.setTerminal(!state.terminal))} />
            </div>
            {state.openAtLogin !== null && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-base text-ink">{t("lending.openAtLogin")}</div>
                  <div className="text-sm text-ink-secondary">{t("lending.awake", { device })}</div>
                </div>
                <Switch checked={state.openAtLogin} aria-label={t("lending.openAtLogin")} onClick={() => run(() => bridge.setOpenAtLogin(!state.openAtLogin))} />
              </div>
            )}
            <Button size="sm" variant="ghost" className="self-start" onClick={() => void bridge.showActivity()}>{t("lending.activity")}</Button>
          </>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </Card>
    </div>
  );
}
