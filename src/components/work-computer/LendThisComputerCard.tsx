import { useEffect, useState } from "react";
import { Folder, Plus, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { lendingBridge, lendingPhase, needsMacPermissions, type LendingPhase, type LendingState } from "@/lib/lending";
import { Switch } from "../SettingsPrimitives";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";

const PHASE_TONE: Record<LendingPhase, BadgeTone> = { off: "outline", paused: "warning", online: "success", connecting: "neutral", problem: "danger" };

function problemLine(state: LendingState): string | null {
  const device = state.device;
  switch (state.problem) {
    case "unsupported": return t("lending.problem.unsupported");
    case "not-admin": return t("lending.problem.notAdmin");
    case "signed-out": return t("lending.problem.signedOut");
    case "other-server": return t("lending.problem.otherServer");
    case "unreachable": return t("lending.problem.unreachable", { device });
    case "refused": return t("lending.problem.refused", { device });
    default: return null;
  }
}

function ScreenRow({ state, run }: { state: LendingState; run: (action: () => Promise<LendingState>) => void }) {
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

/** "Let my bots use this computer", in Settings on a desktop paired with a server. */
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
  const run = (action: () => Promise<LendingState>) => {
    setError("");
    void action().then((next) => setState(next), (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const phase = lendingPhase(state);
  const device = state.device;
  const problem = state.on && !state.paused && state.state !== "online" ? problemLine(state) : null;
  return (
    <div data-lend-this-computer data-lending-phase={phase}>
      <Card title={t("lending.title")} subtitle={state.available ? t("lending.subtitle", { server: state.serverName ?? "", device }) : t("lending.notPaired", { device })}>
        {state.available && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={PHASE_TONE[phase]}>{t(`lending.state.${phase}`)}</Badge>
              {state.busy && <Badge tone="accent">{t("lending.inUse", { device })}</Badge>}
              <span className="flex-1" />
              {!state.on && <Button variant="primary" onClick={() => run(() => bridge.turnOn(name.trim() || undefined))}>{t("lending.turnOn")}</Button>}
              {state.on && (state.paused
                ? <Button onClick={() => run(() => bridge.resume())}>{t("lending.resume")}</Button>
                : <Button onClick={() => run(() => bridge.pause())}>{t("lending.pause")}</Button>)}
              {state.on && <Button variant="danger" onClick={() => run(() => bridge.turnOff())}>{t("lending.turnOff")}</Button>}
            </div>
            {problem && <p className="text-sm text-warning" role="status">{problem}</p>}
            <form className="flex flex-col gap-1.5" onSubmit={(event) => { event.preventDefault(); if (state.on) run(() => bridge.rename(name)); }}>
              <label className="text-sm text-ink-secondary" htmlFor="lending-name">{t("lending.name")}</label>
              <div className="flex gap-2">
                <Input id="lending-name" value={name} placeholder={state.defaultName} maxLength={120} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1" />
                {state.on && name.trim() !== state.name && <Button type="submit">{t("lending.saveName")}</Button>}
              </div>
            </form>
            {state.on && <>
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
        )}
      </Card>
    </div>
  );
}
