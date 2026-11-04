import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarDensity, SidebarToolsLayout } from "@/lib/sidebar-preferences";

const fixture = vi.hoisted(() => ({
  advanced: false,
  dispatch: vi.fn(),
  state: {} as Record<string, unknown>,
  toolsLayout: "rows" as SidebarToolsLayout,
  panels: [] as { id: string; name: string; url: string }[],
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarToolsLayout: () => fixture.toolsLayout,
}));
vi.mock("@/lib/web-panel-preferences", () => ({ useWebPanels: () => fixture.panels }));
import { SidebarAppsButton, SidebarBottomButtons, SidebarFooterNav } from "./SidebarFooterNav";

type Props = { children?: ReactNode; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as ReactElement<Props>;
    return [node, ...nodes(node.props.children)];
  });
}
function render(density: SidebarDensity, { toolsLayout = "rows", ...extra }: { collapsed?: boolean; onToggleCollapsed?: () => void; toolsLayout?: SidebarToolsLayout } = {}) {
  fixture.toolsLayout = toolsLayout;
  let tree!: ReturnType<typeof SidebarFooterNav>;
  function Capture() { tree = SidebarFooterNav({ density, onToggleCollapsed: () => {}, ...extra }); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}

beforeEach(() => {
  fixture.advanced = false;
  fixture.dispatch.mockReset();
  fixture.state = { activeView: "chat", routines: [{ id: "daily", name: "Daily", botId: "scout", enabled: true }], webhooks: [], bots: [{ id: "scout" }], routineRuns: [], pluginsOpen: false };
  fixture.toolsLayout = "rows";
  fixture.panels = [];
  vi.stubGlobal("window", {});
});
afterEach(() => vi.unstubAllGlobals());

describe("sidebar footer places", () => {
  it("leads Advanced mode's places with Automations, with Apps beside the profile instead", () => {
    fixture.advanced = true;
    const { html } = render("comfortable");
    expect(html).toContain('data-sidebar-nav="automations"');
    expect(html).toContain(">Automations</span>");
    expect(html).not.toContain('data-sidebar-nav="routines"');
    expect(html).not.toContain('data-sidebar-nav="triggers"');
    expect(html).not.toContain('data-sidebar-nav="apps"');
  });

  it("leaves no places in Simple mode's sidebar while Files is off: Automations is in the account menu", () => {
    expect(render("comfortable").html).toBe("");
  });

  it.each([false, true])("puts Automations on the avatars-only density ahead of Apps (advanced: %s)", (advanced) => {
    fixture.advanced = advanced;
    const html = render("icons").html;
    expect(html).toContain('aria-label="Automations" title="Automations"');
    expect(html.indexOf('data-sidebar-nav="automations"')).toBeLessThan(html.indexOf('data-sidebar-nav="apps"'));
  });

  it("keeps only Apps on Simple mode's rail: Automations is in its account menu", () => {
    const html = renderToStaticMarkup(createElement(() => SidebarFooterNav({ density: "icons", rail: true })));
    expect(html).toContain('aria-label="Apps" title="Apps"');
    expect(html).toContain('data-tour="tools"');
    expect(html).not.toContain('data-sidebar-nav="automations"');
  });

  it("opens the Automations page through the store, and marks it current while open", () => {
    fixture.advanced = true;
    const { nodes: tree } = render("comfortable");
    (tree.find((node) => node.props.id === "automations" && typeof node.props.onClick === "function")!.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "showRoutines", view: "list" });
    fixture.state.activeView = "routines";
    expect(render("comfortable").html).toMatch(/data-sidebar-nav="automations"[^>]*aria-current="page"/);
  });

  it("adds a row per pinned web panel after Automations, in Advanced mode only", () => {
    fixture.panels = [{ id: "panel-1", name: "Fleet board", url: "http://127.0.0.1:7841/" }];
    fixture.state = { ...fixture.state, activeView: "web-panel", webPanelId: "panel-1" };
    expect(render("comfortable").html).toBe("");
    fixture.advanced = true;
    const { html, nodes: tree } = render("comfortable");
    expect(html.indexOf('data-sidebar-nav="web-panel-panel-1"')).toBeGreaterThan(html.indexOf('data-sidebar-nav="automations"'));
    expect(html).toContain(">Fleet board</span>");
    expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*Fleet board/);
    const row = tree.find((node) => node.props.id === "web-panel-panel-1" && typeof node.props.onClick === "function")!;
    (row.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "showWebPanel", id: "panel-1" });
  });

  it("shows a pinned panel as an icon with its name as the label in the toolbar layout", () => {
    fixture.advanced = true;
    fixture.panels = [{ id: "panel-1", name: "Fleet board", url: "http://127.0.0.1:7841/" }];
    const { html } = render("comfortable", { toolsLayout: "toolbar" });
    expect(html).toContain('data-sidebar-nav="web-panel-panel-1"');
    expect(html).not.toContain(">Fleet board</span>");
    expect(html).toContain('aria-label="Fleet board"');
  });

  it("keeps the guided tour's anchors on the rows", () => {
    fixture.advanced = true;
    const { html } = render("comfortable");
    expect(html).toContain('data-tour="tools"');
    expect(html).toMatch(/data-tour="nav-automations" data-sidebar-nav="automations"/);
  });

  it("carries the dot for an unseen failed run on Automations, and clears it once seen", () => {
    fixture.advanced = true;
    fixture.state.routineRuns = [{ id: "r", routineId: "daily", status: "failed", scheduledFor: 1 }];
    const html = render("comfortable").html;
    expect(html.indexOf('data-testid="routines-attention"')).toBeGreaterThan(html.indexOf('data-sidebar-nav="automations"'));
    fixture.state.routineRuns = [{ id: "r", routineId: "daily", status: "failed", scheduledFor: 1, seenAt: 1 }];
    expect(render("comfortable").html).not.toContain('data-testid="routines-attention"');
  });

  it("leaves the dot off for a failed run whose automation or bot is gone, since Automations has nothing to open and clear", () => {
    fixture.advanced = true;
    fixture.state.routineRuns = [{ id: "r", routineId: "deleted-hook", webhookId: "deleted-hook", status: "failed", scheduledFor: 1 }];
    expect(render("comfortable").html).not.toContain('data-testid="routines-attention"');
    fixture.state.webhooks = [{ id: "deleted-hook", name: "Orders", botId: "scout", enabled: true }];
    expect(render("comfortable").html).toContain('data-testid="routines-attention"');
    fixture.state.bots = [];
    expect(render("comfortable").html).not.toContain('data-testid="routines-attention"');
  });

  it("draws icons with tooltips in the avatars-only density", () => {
    fixture.advanced = true;
    const { html } = render("icons");
    expect(html).toContain('aria-label="Automations" title="Automations"');
    expect(html).not.toContain(">Automations</span>");
  });
});

describe("Tools header", () => {
  it("labels the places with a Tools header, expanded by default", () => {
    fixture.advanced = true;
    const { html } = render("comfortable");
    expect(html).toContain(">Tools<");
    expect(html).toContain('aria-expanded="true"');
    expect(html.indexOf(">Tools<")).toBeLessThan(html.indexOf('data-sidebar-nav="automations"'));
    expect(html).toContain('data-sidebar-nav="automations"');
  });

  it("keeps the Tools label and hides the rows when collapsed", () => {
    fixture.advanced = true;
    const { html } = render("comfortable", { collapsed: true });
    expect(html).toContain(">Tools<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-sidebar-nav="automations"');
  });

  it("toggles through the header", () => {
    fixture.advanced = true;
    const onToggleCollapsed = vi.fn();
    const { nodes: tree } = render("comfortable", { onToggleCollapsed });
    const header = tree.find((node) => typeof node.props.onToggle === "function")!;
    (header.props.onToggle as () => void)();
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("shows the failed-run dot on the header only while collapsed", () => {
    fixture.advanced = true;
    fixture.state.routineRuns = [{ id: "r", routineId: "daily", status: "failed", scheduledFor: 1 }];
    const collapsed = render("comfortable", { collapsed: true }).html;
    expect(collapsed).toContain('data-testid="section-alert"');
    expect(collapsed).not.toContain('data-testid="routines-attention"');
    const expanded = render("comfortable").html;
    expect(expanded).not.toContain('data-testid="section-alert"');
    expect(expanded).toContain('data-testid="routines-attention"');
  });

  it("shows no dot on a collapsed header when nothing needs you", () => {
    fixture.advanced = true;
    expect(render("comfortable", { collapsed: true }).html).not.toContain('data-testid="section-alert"');
  });

  it("draws no Tools header in the avatars-only density or in Simple mode", () => {
    fixture.advanced = true;
    expect(render("icons").html).not.toContain(">Tools<");
    fixture.advanced = false;
    expect(render("comfortable").html).not.toContain(">Tools<");
  });

  it("keeps the guided tour's tools anchor on the header and rows together", () => {
    fixture.advanced = true;
    expect(render("comfortable").html).toContain('data-tour="tools"');
    expect(render("comfortable", { collapsed: true }).html).toContain('data-tour="tools"');
  });
});

function renderBottom() {
  let tree!: ReturnType<typeof SidebarBottomButtons>;
  function Capture() { tree = SidebarBottomButtons(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
describe("the bottom bar beside the profile", () => {
  it.each([false, true])("carries Apps alone: Automations is a Tools row in Advanced and an account menu item in Simple (advanced: %s)", (advanced) => {
    fixture.advanced = advanced;
    const { html } = renderBottom();
    expect(html).not.toContain('data-sidebar-nav="automations"');
    expect(html).toContain('data-sidebar-nav="apps"');
  });
});

describe("Apps beside the profile", () => {
  it.each([false, true])("is one icon button that opens Apps and carries the tour's Apps anchor (advanced: %s)", (advanced) => {
    fixture.advanced = advanced;
    let tree!: ReturnType<typeof SidebarAppsButton>;
    function Capture() { tree = SidebarAppsButton(); return tree; }
    const html = renderToStaticMarkup(createElement(Capture));
    expect(html).toMatch(/data-tour="nav-apps" data-sidebar-nav="apps"/);
    expect(html).toContain('aria-label="Apps"');
    (tree.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "togglePlugins", open: true });
  });
});

describe("toolbar tools layout", () => {
  it("toolbar renders the places as icon buttons with labels", () => {
    fixture.advanced = true;
    const { html } = render("comfortable", { toolsLayout: "toolbar" });
    expect(html).toContain('class="flex flex-row gap-1"');
    expect(html).not.toContain("flex-col");
    expect(html).toContain('aria-label="Automations" title="Automations"');
    expect(html).not.toContain(">Automations</span>");
  });

  it("toolbar keeps tour anchors and aria-current", () => {
    fixture.advanced = true;
    fixture.state.activeView = "routines";
    const { html } = render("comfortable", { toolsLayout: "toolbar" });
    expect(html).toContain('data-tour="tools"');
    expect(html).toMatch(/data-tour="nav-automations" data-sidebar-nav="automations"/);
    const place = (id: string) => {
      const at = html.indexOf(`data-sidebar-nav="${id}"`);
      const next = html.indexOf("data-sidebar-nav=", at + 1);
      return html.slice(at, next === -1 ? undefined : next);
    };
    expect(place("automations")).toContain('aria-current="page"');
  });

  it("toolbar shows the failed-run dot and clears it once seen", () => {
    fixture.advanced = true;
    fixture.state.routineRuns = [{ id: "r", routineId: "daily", status: "failed", scheduledFor: 1 }];
    expect(render("comfortable", { toolsLayout: "toolbar" }).html).toContain('data-testid="routines-attention"');
    fixture.state.routineRuns = [{ id: "r", routineId: "daily", status: "failed", scheduledFor: 1, seenAt: 1 }];
    expect(render("comfortable", { toolsLayout: "toolbar" }).html).not.toContain('data-testid="routines-attention"');
  });

  it("toolbar applies to Advanced mode's Automations; Simple mode keeps it in the account menu instead", () => {
    fixture.advanced = true;
    expect(render("comfortable", { toolsLayout: "toolbar" }).html.match(/data-sidebar-nav="/g)).toHaveLength(1);
    fixture.advanced = false;
    expect(render("comfortable", { toolsLayout: "toolbar" }).html).toBe("");
  });

  it("icons density ignores the tools layout", () => {
    fixture.advanced = true;
    const rows = render("icons").html;
    expect(render("icons", { toolsLayout: "toolbar" }).html).toBe(rows);
    expect(rows).toContain('class="flex flex-col items-center gap-1"');
  });

  it("rows layout renders exactly as before", () => {
    fixture.advanced = true;
    const unset = render("comfortable").html;
    expect(render("comfortable", { toolsLayout: "rows" }).html).toBe(unset);
    expect(unset).toContain('<div data-tour="tools">');
    expect(unset).toContain('<nav aria-label="Tools" class="flex flex-col gap-0.5">');
    expect(unset).not.toContain("flex-row");
    expect(unset).toContain(">Automations</span>");
    expect(unset).not.toContain('title="Automations"');
    expect(unset).not.toContain('aria-label="Automations"');
  });
});
