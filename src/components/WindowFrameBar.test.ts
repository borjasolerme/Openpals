// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  windowChrome: "mac-inset" as "mac-inset" | "win-caption" | "native",
  windowFrame: undefined as boolean | undefined,
  dispatch: vi.fn(),
  notifications: [] as Array<{ read: boolean }>,
  notificationsOpen: false,
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { notifications: fixture.notifications, notificationsOpen: fixture.notificationsOpen }, dispatch: fixture.dispatch }) }));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { windowChrome: fixture.windowChrome, windowFrame: fixture.windowFrame }, ready: true }),
}));

import { setLocale } from "@/lib/i18n";
import { NotificationRail } from "./NotificationsPanel";
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
  fixture.notifications = [];
  fixture.notificationsOpen = false;
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
    expect(host.querySelector("[data-frame-bar-end]")!.className).toContain("pr-35");
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

  it("holds the Notifications bell beside Settings, with the unread count, and it opens and closes the tray", async () => {
    fixture.notifications = [{ read: false }, { read: true }, { read: false }];
    await mount(createElement(WindowFrameBar, { notifications: true }));
    const bell = () => bar()!.querySelector<HTMLButtonElement>("[data-notification-bell]")!;
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 2 unread");
    expect(bell().textContent, "the unread count on the bell").toBe("2");
    expect(bell().className.split(" ")).toEqual(expect.arrayContaining(["size-5.5", "relative"]));
    expect(bell().getAttribute("aria-pressed")).toBe("false");
    const order = [...bar()!.querySelectorAll("button")].map((button) => button.hasAttribute("data-notification-bell") ? "bell" : button.getAttribute("aria-label"));
    expect(order, "right before Settings, at the right end").toEqual(["bell", "App settings"]);
    await act(async () => bell().click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleNotifications" });
    fixture.notificationsOpen = true;
    await act(async () => root!.render(createElement(WindowFrameBar, { notifications: true })));
    expect(bell().getAttribute("aria-pressed"), "it stays in the bar while the tray is open, to close it").toBe("true");
    expect(bell().className.split(" ")).toContain("text-accent");
  });

  it("has no bell where the tray is off (turned off, the calendar)", async () => {
    await mount(createElement(WindowFrameBar));
    expect(bar()!.querySelector("[data-notification-bell]")).toBeNull();
  });
});

describe("the bell on the window's edge, for windows without the top bar", () => {
  it("is the same bell at the edge's size, with the unread count, and steps away while the tray is open", async () => {
    fixture.notifications = [{ read: false }];
    await mount(createElement(NotificationRail));
    const bell = host.querySelector<HTMLButtonElement>("aside [data-notification-bell]")!;
    expect(bell.getAttribute("aria-label")).toBe("Notifications, 1 unread");
    expect(bell.className.split(" ")).toEqual(expect.arrayContaining(["size-8", "relative"]));
    await act(async () => bell.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleNotifications" });
    fixture.notificationsOpen = true;
    await act(async () => root!.render(createElement(NotificationRail)));
    expect(host.querySelector("aside")).toBeNull();
  });
});
