import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { name: "Openpals" },
  Menu: { buildFromTemplate: (template) => template },
}));

import { buildApplicationMenu } from "./menu.mjs";

describe("buildApplicationMenu", () => {
  const originalPlatform = process.platform;

  function withPlatform(platform, fn) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
      return fn();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  }

  const build = (platform, overrides = {}) =>
    withPlatform(platform, () =>
      buildApplicationMenu({
        server: null,
        onConnectFromClipboard: vi.fn(),
        onDisconnect: vi.fn(),
        ...overrides,
      }),
    );
  const serverItems = (template) => template.find((entry) => entry.label === "Server").submenu;

  it.each(["darwin", "linux", "win32"])("offers to connect from a copied pairing link while the window shows this computer on %s", (platform) => {
    const onConnectFromClipboard = vi.fn();
    const items = serverItems(build(platform, { onConnectFromClipboard }));
    expect(items.map((entry) => entry.id)).toEqual(["server-connect"]);
    items[0].click();
    expect(onConnectFromClipboard).toHaveBeenCalledTimes(1);
  });

  it.each(["darwin", "linux", "win32"])("offers only to disconnect from the server the window shows on %s, never a list to switch between", (platform) => {
    const onDisconnect = vi.fn();
    const items = serverItems(build(platform, { server: { name: "Mac mini", origin: "https://mac-mini.tail1f3f14.ts.net" }, onDisconnect }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "server-disconnect", label: "Disconnect from “Mac mini”…" });
    expect(items[0].type).toBeUndefined();
    items[0].click();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it.each(["darwin", "linux", "win32"])("offers Open at Login on %s, in the app menu on macOS and the File menu elsewhere", (platform) => {
    const onToggle = vi.fn();
    const template = build(platform, { openAtLogin: { checked: false, onToggle } });
    const item = template[0].submenu.find((entry) => entry.id === "open-at-login");
    expect(template[0].label).toBe(platform === "darwin" ? "Openpals" : "File");
    expect(item).toMatchObject({ label: "Open at Login", type: "checkbox", checked: false });
    item.click();
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(build(platform).flatMap((menu) => menu.submenu ?? []).some((entry) => entry.id === "open-at-login")).toBe(false);
  });

  it("macOS app menu wires an explicit Preferences item to the settings callback", () => {
    const onOpenSettings = vi.fn();
    const template = build("darwin", { onOpenSettings });
    const item = template[0].submenu.find((entry) => entry.label === "Preferences…");
    expect(item).toBeDefined();
    expect(item.accelerator).toBe("CmdOrCtrl+,");
    expect(item.click).toBeTypeOf("function");
    item.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it.each(["linux", "win32"])("does not add an app menu on %s", (platform) => {
    const template = build(platform);
    expect(template[0].role).toBe("fileMenu");
    for (const item of template) {
      expect(item.label).not.toBe("Openpals");
    }
  });

});
