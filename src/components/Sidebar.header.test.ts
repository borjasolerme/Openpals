import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialDesktopCapabilities } from "@/lib/desktop";
import { setLocale } from "@/lib/i18n";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { StoreProvider } from "@/state/store";

const fixture = vi.hoisted(() => ({
  density: "comfortable" as SidebarDensity,
  advanced: true,
  windowChrome: undefined as "mac-inset" | "win-caption" | "native" | undefined,
  windowFrame: undefined as boolean | undefined,
  hostLabel: undefined as string | undefined,
}));

vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarDensity: () => fixture.density,
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => {
    const capabilities = initialDesktopCapabilities();
    const host = { ...capabilities.host, label: fixture.hostLabel ?? capabilities.host.label };
    return { capabilities: { ...capabilities, host, windowChrome: fixture.windowChrome, windowFrame: fixture.windowFrame }, ready: true };
  },
}));

import { Sidebar } from "./Sidebar";

const render = () => renderToStaticMarkup(
  createElement(StoreProvider, null, createElement(Sidebar, { open: true, onClose: () => {} })),
);

beforeEach(() => {
  fixture.density = "comfortable";
  fixture.advanced = true;
  fixture.windowChrome = undefined;
  fixture.windowFrame = undefined;
  fixture.hostLabel = undefined;
  vi.stubGlobal("window", { innerWidth: 1280, location: { protocol: "http:", search: "" } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("sidebar header", () => {
  const collapse = /aria-label="(Collapse sidebar to avatars|Expand sidebar)"|data-sidebar-edge-toggle/;

  it.each(["comfortable", "icons"] as const)("keeps add, no activity menu and no button that collapses or expands it, at %s density in Advanced mode", (density) => {
    fixture.density = density;
    const html = render();
    expect(html).not.toContain('aria-label="Active Threads"');
    expect(html).toContain('aria-label="New or share"');
    expect(html).not.toMatch(collapse);
  });

  it.each(["comfortable", "icons"] as const)("keeps add, no activity menu and no collapse button in Simple mode at %s density: its edge is dragged instead", (density) => {
    fixture.advanced = false;
    fixture.density = density;
    const html = render();
    expect(html).not.toContain('aria-label="Active Threads"');
    expect(html).toContain('aria-label="New or share"');
    expect(html).not.toMatch(collapse);
    expect(html, "the edge that is dragged, open or as avatars, so the avatars are never a dead end").toMatch(/role="separator" aria-label="Resize sidebar"/);
  });
});

describe("sidebar top row", () => {
  const desktop = () => vi.stubGlobal("window", {
    innerWidth: 1280,
    location: { protocol: "http:", search: "" },
    ogb: {},
  });
  const topRow = (html: string) => {
    const start = html.indexOf("data-sidebar-top-row");
    const end = html.indexOf('aria-label="New or share"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return html.slice(start, end);
  };
  const classesOf = (html: string, attribute: string) => {
    const match = new RegExp(`${attribute}(?:="[^"]*")? class="([^"]*)"`).exec(html);
    expect(match, attribute).not.toBeNull();
    return match![1].split(" ");
  };
  const order = (row: string) => ({
    lights: row.indexOf("data-traffic-light-space"),
    slot: row.indexOf("data-sidebar-top-slot"),
    buttons: row.indexOf("data-sidebar-top-buttons"),
  });

  it("leaves the traffic lights to the window frame's top bar on macOS: a drag space, then the buttons in Advanced mode", () => {
    fixture.windowChrome = "mac-inset";
    desktop();
    const html = render();
    const row = topRow(html);
    expect(row).toMatch(/^data-sidebar-top-row="true" class="[^"]*\bitems-center\b[^"]*\bh-12\b[^"]*" style="-webkit-app-region:drag"/);
    const { lights, slot, buttons } = order(row);
    expect(lights).toBe(-1);
    expect(slot).toBeGreaterThan(-1);
    expect(buttons).toBeGreaterThan(slot);
    expect(row.slice(buttons).match(/<button/g)).toHaveLength(1);
    const rowClasses = classesOf(row, "data-sidebar-top-row");
    expect(rowClasses).toEqual(expect.arrayContaining(["relative", "pl-4", "pr-2"]));
    expect(rowClasses).not.toContain("px-4");
    expect(classesOf(row, "data-sidebar-top-slot")).toEqual(["min-w-0", "flex-1"]);
    expect(classesOf(row, "data-sidebar-top-buttons")).toEqual(expect.arrayContaining(["shrink-0", "gap-0.5"]));
    expect(html).toContain('title="New or share"');
  });

  it.each(["mac-inset", "win-caption"] as const)("in Simple mode on %s keeps only the top corner: plain search and + at its right end, no drag region, no server pill, nothing on the edge", (windowChrome) => {
    fixture.advanced = false;
    fixture.windowChrome = windowChrome;
    desktop();
    const html = render();
    const row = topRow(html);
    expect(row, "the bot tiles rise into the rest of the corner: no drag region, no clicks but the buttons'").toMatch(/^data-sidebar-top-row="corner" class="[^"]*\bpointer-events-none\b[^"]*\bh-8.5[^"]*\bitems-start\b[^"]*">/);
    expect(classesOf(row, "data-sidebar-top-row")).toEqual(expect.arrayContaining(["justify-end", "px-1.5", "pt-1.5"]));
    const { lights, slot, buttons } = order(row);
    expect(lights).toBe(-1);
    expect(buttons).toBeGreaterThan(slot);
    expect(classesOf(row, "data-sidebar-top-buttons")).toEqual(expect.arrayContaining(["shrink-0", "pointer-events-auto"]));
    expect(row.slice(buttons).match(/<button/g)).toHaveLength(2);
    expect(row).toMatch(/data-sidebar-search-toggle="true" aria-label="Search bots and messages" aria-expanded="false" title="Search bots and messages" class="[^"]*\bsize-6.5[^"]*\brounded-lg\b[^"]*\btext-ink-secondary\b/);
    expect(row, "no round box round either").not.toContain("bg-composer");
    expect(html).toMatch(/aria-label="New or share" class="[^"]*\bsize-6.5[^"]*\brounded-lg\b/);
    expect(html).not.toContain("data-sidebar-edge-toggle");
    expect(html).not.toContain('title="Active Threads"');
    expect(html).not.toContain("data-sidebar-search-pill");
  });

  it.each([["win-caption", "Windows"], ["native", "Linux"]] as const)(
    "keeps the same right-aligned order without traffic lights (%s)",
    (windowChrome, hostLabel) => {
      fixture.windowChrome = windowChrome;
      fixture.hostLabel = hostLabel;
      desktop();
      const html = render();
      const row = topRow(html);
      expect(row).not.toContain("data-traffic-light-space");
      expect(row).not.toContain("bg-[#ff5f57]");
      expect(classesOf(row, "data-sidebar-top-row")).toEqual(expect.arrayContaining(["relative", "h-12", "pl-4", "pr-2"]));
      const { slot, buttons } = order(row);
      expect(slot).toBeGreaterThan(-1);
      expect(buttons).toBeGreaterThan(slot);
    },
  );

  it("with the frame turned off on macOS, makes room for the traffic lights in its corner again", () => {
    fixture.windowChrome = "mac-inset";
    fixture.windowFrame = false;
    desktop();
    const advanced = topRow(render());
    expect(advanced).toMatch(/^data-sidebar-top-row="true" class="[^"]*" style="-webkit-app-region:drag;height:46px"/);
    expect(classesOf(advanced, "data-traffic-light-space")).toEqual(["w-18", "shrink-0"]);
    expect(advanced.indexOf("data-traffic-light-space")).toBeLessThan(advanced.indexOf("data-sidebar-top-slot"));
    fixture.advanced = false;
    const simple = topRow(render());
    expect(simple, "Simple keeps its own top row, not the frame's corner").toMatch(/^data-sidebar-top-row="true"/);
    expect(simple.indexOf("data-traffic-light-space")).toBeLessThan(simple.indexOf("data-sidebar-top-slot"));
    fixture.density = "icons";
    expect(classesOf(render(), "data-traffic-light-space"), "the column of avatars keeps a strip above for them").toEqual(["h-5", "w-full"]);
  });

  it("with the frame turned off on Windows, its own title bar is back: nothing makes room and nothing drags", () => {
    fixture.windowChrome = "native";
    fixture.windowFrame = false;
    fixture.hostLabel = "Windows";
    desktop();
    const row = topRow(render());
    expect(row).not.toContain("data-traffic-light-space");
    expect(row).not.toContain("app-region:drag");
  });

  it("draws no window buttons in a browser, where the browser has its own", () => {
    const row = topRow(render());
    expect(row).not.toContain("bg-[#ff5f57]");
    expect(row).not.toContain("data-traffic-light-space");
    const { slot, buttons } = order(row);
    expect(buttons).toBeGreaterThan(slot);
  });

  it("collapses Simple mode to a rail: round search and + on top (the frame's top bar holds the lights), nothing on the edge, and Apps and the account at the foot", () => {
    fixture.advanced = false;
    fixture.density = "icons";
    fixture.windowChrome = "mac-inset";
    desktop();
    const html = render();
    const top = html.slice(html.indexOf("data-sidebar-top-row"), html.indexOf("data-sidebar-rail-footer"));
    expect(top).not.toContain("data-traffic-light-space");
    expect(top).not.toContain("data-sidebar-top-buttons");
    expect(top.indexOf('aria-label="Search bots and messages"')).toBeLessThan(top.indexOf('aria-label="New or share"'));
    expect(top).toMatch(/data-sidebar-rail-top="true" class="flex flex-col items-center gap-2 pt-1"/);
    expect(top).toMatch(/aria-label="New or share" class="[^"]*\bsize-9\b[^"]*\brounded-full\b/);
    const foot = html.slice(html.indexOf("data-sidebar-rail-footer"));
    const at = (marker: string) => {
      const index = foot.indexOf(marker);
      expect(index, marker).toBeGreaterThan(-1);
      return index;
    };
    expect(html).not.toContain("data-sidebar-edge-toggle");
    expect(foot).not.toContain('aria-label="Search bots and messages"');
    const positions = [
      at('data-sidebar-nav="apps"'),
      at("data-sidebar-account"),
    ];
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(foot).toMatch(/data-tour="nav-apps" data-sidebar-nav="apps"[^>]*aria-label="Connect apps"[^>]*class="[^"]*\bsize-9\b[^"]*"><svg[^>]*lucide-puzzle/);
    expect(foot).not.toContain('data-sidebar-nav="automations"');
    expect(html.match(/aria-label="New or share"/g)).toHaveLength(1);
  });

  it("stacks the icons rail unchanged", () => {
    fixture.density = "icons";
    fixture.windowChrome = "mac-inset";
    desktop();
    const html = render();
    const row = topRow(html);
    expect(classesOf(row, "data-sidebar-top-row")).toEqual(["flex", "items-center", "flex-col", "gap-1", "px-2", "pt-3.5", "pb-1"]);
    expect(row).not.toContain("data-traffic-light-space");
    expect(classesOf(row, "data-sidebar-top-buttons")).toEqual(["relative", "flex", "shrink-0", "items-center", "flex-col", "gap-1"]);
  });
});

describe("sidebar head and foot", () => {
  it.each(["comfortable", "icons"] as const)(
    "puts the top row and search in the head, the places in the foot, and the fading list between at %s density",
    (density) => {
      fixture.density = density;
      const html = render();
      const at = (marker: string) => {
        const index = html.indexOf(marker);
        expect(index, marker).toBeGreaterThan(-1);
        return index;
      };
      const head = at('data-glass-bar="top"');
      const topRow = at("data-sidebar-top-row");
      const search = at('aria-label="Search bots and messages"');
      const list = at('data-scroll-fade-frame=""');
      const foot = at('data-glass-bar="bottom"');
      const automations = at('data-sidebar-nav="automations"');
      expect(head).toBeLessThan(topRow);
      expect(topRow).toBeLessThan(search);
      expect(search).toBeLessThan(list);
      expect(list).toBeLessThan(foot);
      expect(foot).toBeLessThan(automations);
      expect(html.match(/data-sidebar-nav="automations"/g)).toHaveLength(1);
      expect(html.match(/data-glass-frame=""/g)).toHaveLength(1);
      expect(at("data-glass-frame")).toBeLessThan(head);
    },
  );
});

describe("sidebar foot in Simple mode", () => {
  it("puts the account avatar then the Connect apps pill in the foot, with Automations and Team map in the account menu", () => {
    fixture.advanced = false;
    const html = render();
    const foot = html.slice(html.indexOf('data-glass-bar="bottom"'));
    expect(foot).toContain('data-sidebar-footer="simple"');
    expect(html).not.toContain('data-sidebar-nav="automations"');
    expect(html.match(/data-sidebar-nav="apps"/g)).toHaveLength(1);
    expect(foot.indexOf("data-sidebar-account")).toBeGreaterThan(-1);
    expect(foot.indexOf("data-sidebar-account")).toBeLessThan(foot.indexOf('data-sidebar-nav="apps"'));
    expect(foot).toMatch(/data-tour="nav-apps" data-sidebar-nav="apps"[^>]*>(<[^>]*>)*Connect apps</);
    expect(foot.match(/data-app-face="/g)).toHaveLength(3);
  });

  it("keeps one Automations row in the foot and no Routines row in Advanced mode, and still one Apps", () => {
    fixture.advanced = true;
    const html = render();
    expect(html).not.toContain('data-sidebar-nav="routines"');
    expect(html.match(/data-sidebar-nav="automations"/g)).toHaveLength(1);
    expect(html.indexOf('data-sidebar-nav="automations"')).toBeGreaterThan(html.indexOf('data-glass-bar="bottom"'));
    expect(html.match(/data-sidebar-nav="apps"/g)).toHaveLength(1);
  });
});
