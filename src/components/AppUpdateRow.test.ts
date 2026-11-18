// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { AppUpdateState } from "../../electron/app-update.mjs";
import { AppUpdateRow } from "./AppUpdateRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const current = { commit: "0123456789abcdef0123456789abcdef01234567", builtAt: "2026-11-10T12:00:00.000Z" };
const latest = { commit: "f".repeat(40), publishedAt: "2026-11-15T09:00:00Z", url: "https://github.com/borjasolerme/Openpals/releases/tag/v2" };
const snapshot = (next: Partial<AppUpdateState>): AppUpdateState =>
  ({ state: "idle", current, canInstall: false, downloadPage: latest.url, ...next });

let host: HTMLDivElement, root: Root | null = null;
let push: ((state: AppUpdateState) => void) | null = null;
const check = vi.fn<() => Promise<AppUpdateState>>();
const install = vi.fn<() => Promise<AppUpdateState>>();
const openExternal = vi.fn(async () => true);

beforeEach(() => {
  setLocale("en");
  check.mockReset(); install.mockReset(); openExternal.mockClear();
  push = null;
  Object.assign(window, { ogb: {
    openExternal,
    updates: {
      state: async () => snapshot({}),
      check, install,
      onState: (cb: (state: AppUpdateState) => void) => { push = cb; return () => { push = null; }; },
      onOpen: () => () => {},
    },
  } });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); delete (window as { ogb?: unknown }).ogb; });

async function mount() {
  root = createRoot(host);
  await act(async () => root!.render(createElement(AppUpdateRow)));
  await act(async () => { await Promise.resolve(); });
}
const button = (name: "check" | "install" | "page") => host.querySelector<HTMLButtonElement>(`[data-update-${name}]`);
const show = async (state: AppUpdateState) => act(async () => push!(state));

describe("Settings' Check for updates row", () => {
  it("names this build by short commit and date, and checks on request", async () => {
    check.mockResolvedValue(snapshot({ state: "current", latest }));
    await mount();
    expect(host.textContent).toContain("Openpals 0123456 · Nov 10, 2026");
    expect(button("check")?.textContent).toBe("Check for updates");
    await act(async () => { button("check")!.click(); await Promise.resolve(); });
    expect(check).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("You're up to date");
  });

  it("shows Checking… with the button held, then a new version with Update and restart", async () => {
    install.mockResolvedValue(snapshot({ state: "installing", latest }));
    await mount();
    await show(snapshot({ state: "checking" }));
    expect(host.textContent).toContain("Checking…");
    expect(button("check")?.disabled).toBe(true);
    await show(snapshot({ state: "available", latest, canInstall: true }));
    expect(host.textContent).toContain("New version available");
    expect(button("check")).toBeNull();
    expect(button("install")?.textContent).toBe("Update and restart");
    await act(async () => { button("install")!.click(); await Promise.resolve(); });
    expect(install).toHaveBeenCalledOnce();
  });

  it("shows the download's progress, then Installing…, with nothing to press", async () => {
    await mount();
    await show(snapshot({ state: "downloading", percent: 42, latest }));
    expect(host.textContent).toContain("Downloading 42%…");
    expect(host.querySelector("button")).toBeNull();
    await show(snapshot({ state: "verifying", latest }));
    expect(host.textContent).toContain("Installing…");
    await show(snapshot({ state: "installing", latest }));
    expect(host.textContent).toContain("Installing…");
    expect(host.querySelector("button")).toBeNull();
  });

  it("offers the download page where it can't update itself, and after an error", async () => {
    await mount();
    await show(snapshot({ state: "available", latest, canInstall: false }));
    expect(button("install")).toBeNull();
    await act(async () => { button("page")!.click(); });
    expect(openExternal).toHaveBeenCalledWith(latest.url);
    await show(snapshot({ state: "error", error: "verify", latest }));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("isn't signed by the same developer");
    expect(button("page")?.textContent).toBe("Open download page");
    expect(button("check")).not.toBeNull();
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    await mount();
    expect(button("check")?.textContent).toBe("Buscar actualizaciones");
    await show(snapshot({ state: "available", latest, canInstall: true }));
    expect(host.textContent).toContain("Hay una versión nueva");
    expect(button("install")?.textContent).toBe("Actualizar y reiniciar");
  });

  it("is absent outside the desktop app, and on a server's page, which has no updates bridge", async () => {
    delete (window as { ogb?: unknown }).ogb;
    await mount();
    expect(host.innerHTML).toBe("");
    await act(async () => root!.unmount());
    Object.assign(window, { ogb: { openExternal } });
    await mount();
    expect(host.innerHTML).toBe("");
  });
});
