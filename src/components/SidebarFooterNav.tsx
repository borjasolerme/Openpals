import { Globe, Puzzle, Zap } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { automationsFrom, hasUnseenProblemRun } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useWebPanels } from "@/lib/web-panel-preferences";
import { useSidebarToolsLayout, type SidebarDensity } from "@/lib/sidebar-preferences";
import { useStore } from "@/state/store";

import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { IconButton } from "./ui/IconButton";
import { rowClass } from "./ui/Row";


function NavRow({
  id,
  label,
  icon,
  active = false,
  attention = false,
  iconsOnly,
  rail = false,
  tourId,
  onClick,
}: {
  id: string;
  label: string;
  icon: (active: boolean) => ReactNode;
  active?: boolean;
  attention?: boolean;
  iconsOnly: boolean;
  rail?: boolean;
  tourId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tour={tourId}
      data-sidebar-nav={id}
      onClick={onClick}
      aria-label={iconsOnly ? label : undefined}
      title={iconsOnly ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={iconsOnly
        ? cn("relative flex items-center justify-center rounded-xl transition-colors", rail ? "size-9 shrink-0" : "mx-auto size-11.5 shrink-0",
          active ? "bg-raised text-ink" : "text-ink hover:bg-raised/50")
        : rowClass(active, "relative")}
    >
      {icon(active)}
      {!iconsOnly && <span className="flex-1 truncate">{label}</span>}
      {attention && (
        <span
          data-testid="routines-attention"
          className={cn("size-2 shrink-0 rounded-full bg-danger", iconsOnly && (rail ? "absolute right-1 top-1" : "absolute right-2 top-2"))}
        />
      )}
    </button>
  );
}

export function SidebarAppsButton() {
  const { state, dispatch } = useStore();
  const label = t("sidebar.nav.apps");
  return (
    <IconButton
      size="lg"
      data-tour="nav-apps"
      data-sidebar-nav="apps"
      onClick={() => dispatch({ type: "togglePlugins", open: true })}
      label={label}
      aria-pressed={state.pluginsOpen}
      active={state.pluginsOpen}
      icon={<Puzzle size={16} />}
    />
  );
}

/** An unseen failed run of an automation the Automations page lists (the same list, so opening it clears the dot). */
export function useAutomationsNeedYou(): boolean {
  const { state } = useStore();
  return useMemo(() => hasUnseenProblemRun(automationsFrom({ routines: state.routines, webhooks: state.webhooks, runs: state.routineRuns, bots: state.bots })),
    [state.routines, state.webhooks, state.routineRuns, state.bots]);
}

export function SidebarBottomButtons() {
  return (
    <div data-sidebar-bottom-buttons="" className="flex shrink-0 items-center gap-0.5">
      <SidebarAppsButton />
    </div>
  );
}

export function SidebarFooterNav({
  density,
  rail = false,
  collapsed = false,
  onToggleCollapsed,
}: {
  density: SidebarDensity;
  rail?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const webPanels = useWebPanels();
  const iconsOnly = density === "icons";
  const toolsLayout = useSidebarToolsLayout();
  const toolbar = advanced && !iconsOnly && toolsLayout === "toolbar";
  const iconSize = iconsOnly && !rail ? 20 : iconsOnly ? 18 : 16;
  const tone = (active: boolean) => (active ? "text-accent" : "text-ink-secondary");
  const automationsNeedYou = useAutomationsNeedYou();
  const automationsRow = <NavRow
    id="automations"
    label={t("sidebar.nav.automations")}
    tourId="nav-automations"
    iconsOnly={iconsOnly || toolbar}
    active={state.activeView === "routines"}
    attention={automationsNeedYou}
    icon={(active) => <Zap size={iconSize} className={tone(active)} />}
    onClick={() => dispatch({ type: "showRoutines", view: "list" })}
  />;
  if (!advanced && !iconsOnly) return null;
  const appsRow = iconsOnly && <NavRow
    id="apps"
    label={t("sidebar.nav.apps")}
    tourId="nav-apps"
    iconsOnly={iconsOnly}
    rail={rail}
    active={state.pluginsOpen}
    icon={(active) => <Puzzle size={iconSize} className={tone(active)} />}
    onClick={() => dispatch({ type: "togglePlugins", open: true })}
  />;
  if (rail) return <nav data-tour="tools" aria-label={t("sidebar.tools")} className="flex flex-col items-center gap-0.5">{appsRow}</nav>;

  const rows = (
    <>
      {automationsRow}
      {appsRow}
      {advanced && webPanels.map((panel) => (
        <NavRow
          key={panel.id}
          id={`web-panel-${panel.id}`}
          label={panel.name}
          iconsOnly={iconsOnly || toolbar}
          active={state.activeView === "web-panel" && state.webPanelId === panel.id}
          icon={(active) => <Globe size={iconSize} className={tone(active)} />}
          onClick={() => dispatch({ type: "showWebPanel", id: panel.id })}
        />
      ))}
    </>
  );

  if (iconsOnly) {
    return <nav data-tour="tools" aria-label={t("sidebar.tools")} className="flex flex-col items-center gap-1">{rows}</nav>;
  }
  return (
    <div data-tour="tools">
      <SidebarSectionHeader
        name={t("sidebar.tools")}
        collapsed={collapsed}
        alert={collapsed && automationsNeedYou}
        onToggle={onToggleCollapsed}
        reorderable={false}
        dragging={false}
      />
      {!collapsed && <nav aria-label={t("sidebar.tools")} className={toolbar ? "flex flex-row gap-1" : "flex flex-col gap-0.5"}>{rows}</nav>}
    </div>
  );
}
