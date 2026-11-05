// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  windowChrome: "mac-inset" as "mac-inset" | "win-caption" | "native",
  windowFrame: undefined as boolean | undefined,
  dispatch: vi.fn(),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: {}, dispatch: fixture.dispatch }) }));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { windowChrome: fixture.windowChrome, windowFrame: fixture.windowFrame }, ready: true }),
}));

import { setLocale } from "@/lib/i18n";
import { tilesClearCorner } from "./SidebarTiles";
import { WindowFrameBar } from "./WindowFrameBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null = null;
beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  fixture.windowChrome = "mac-inset";
  fixture.windowFrame = undefined;
  fixture.dispatch.mockClear();
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); });

async function mount(element: ReturnType<typeof createElement>) {
  root = createRoot(host);
  await act(async () => root!.render(element));
  await act(async () => { await Promise.resolve(); });
}
const bar = () => host.querySelector<HTMLElement>("[data-window-frame-bar]");

describe("the window frame's top bar", () => {
  it("is drawn on macOS, as thin as the traffic lights allow, and drags the window", async () => {
    await mount(createElement(WindowFrameBar));
    expect(bar()!.className.split(" ")).toEqual(expect.arrayContaining(["h-7", "bg-frame"]));
    expect(bar()!.hasAttribute("data-window-drag"), "the drag region every header marks (window-drag-regions.test.ts)").toBe(true);
    expect([...bar()!.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual(["App settings"]);
  });

  it("leaves the caption buttons the right end on Windows, and draws nothing where the window has its own title bar", async () => {
    fixture.windowChrome = "win-caption";
    await mount(createElement(WindowFrameBar));
    expect(host.querySelector("[data-frame-bar-end]")!.className).toContain("pr-[140px]");
    await act(async () => root!.unmount());
    fixture.windowChrome = "native";
    await mount(createElement(WindowFrameBar));
    expect(bar()).toBeNull();
  });

  it("draws nothing once the person turned the frame off", async () => {
    fixture.windowFrame = false;
    await mount(createElement(WindowFrameBar));
    expect(bar()).toBeNull();
    fixture.windowFrame = true;
    await act(async () => root!.render(createElement(WindowFrameBar)));
    expect(bar()).not.toBeNull();
  });

  it("opens the app's settings", async () => {
    await mount(createElement(WindowFrameBar));
    await act(async () => bar()!.querySelector<HTMLButtonElement>("[data-frame-settings]")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true });
  });
});

describe("Simple's sidebar corner", () => {
  // A 280px sidebar: 78px tiles 4px apart, centred, the grid's right edge at 280.
  const row = (count: number, top = 10) => {
    const width = count * 82 - 4, left = (280 - width) / 2;
    return Array.from({ length: count }, (_, index) => ({ top, right: left + index * 82 + 78 }));
  };

  it("lets the tiles rise beside Search and New only while their first row ends before them", () => {
    expect(tilesClearCorner(row(1), 280)).toBe(true);
    expect(tilesClearCorner(row(2), 280)).toBe(true);
    expect(tilesClearCorner(row(3), 280)).toBe(false);
    expect(tilesClearCorner([...row(2), ...row(1, 106)], 280), "a second row under it changes nothing").toBe(true);
    expect(tilesClearCorner(row(2), 240), "a narrower sidebar").toBe(false);
    expect(tilesClearCorner([], 280)).toBe(false);
  });
});
