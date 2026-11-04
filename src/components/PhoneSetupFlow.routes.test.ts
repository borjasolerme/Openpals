// @vitest-environment happy-dom
// The real controller and view run against a fake preload bridge.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { PhoneSetupFlowView, usePhoneSetupController, type CompanionState } from "./PhoneSetupFlow";

/** Settings' pairing panel: the flow with its own controller, as CompanionSection mounts it. */
function PhoneSetupFlow() {
  return createElement(PhoneSetupFlowView, { controller: usePhoneSetupController() });
}

const TAILNET = "mac.tail1234.ts.net";

function desktop(initial: Partial<CompanionState> = {}) {
  let companion: CompanionState = { enabled: false, keepAwake: false, port: 8810, devices: [], pairing: null, ...initial };
  const companionBridge = {
    state: vi.fn(async () => companion),
    start: vi.fn(async () => {
      companion = { ...companion, enabled: true, lan: "192.168.1.34" };
      return companion;
    }),
    stop: vi.fn(async () => companion),
    keepAwake: vi.fn(async () => companion),
    refreshTailscale: vi.fn(async () => companion),
    pairing: vi.fn(async (open: boolean) => {
      companion = {
        ...companion,
        pairing: open
          ? { code: "123456", token: `omb_pair_${"a".repeat(43)}`, expiresAt: Date.now() + 120_000 }
          : null,
      };
      return companion;
    }),
    cloudDesktop: vi.fn(async () => companion),
    browserControl: vi.fn(async () => companion),
    revoke: vi.fn(async () => companion),
  };
  return { companion: companionBridge };
}

let host: HTMLDivElement;
let root: Root;
const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label) ?? null;

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete (globalThis as { ogb?: unknown }).ogb;
});

async function mount(bridge: ReturnType<typeof desktop>) {
  (globalThis as { ogb?: unknown }).ogb = bridge;
  flushSync(() => root.render(createElement(PhoneSetupFlow)));
  await vi.waitFor(() => expect(button("Pair a device")?.disabled).toBe(false));
}

describe("pairing a device", () => {
  it("turns remote access on and opens a code on this network when there is no tailnet", async () => {
    const fake = desktop();
    await mount(fake);
    expect(button("Pair on this Wi-Fi instead")).toBeNull();
    button("Pair a device")!.click();
    await vi.waitFor(() => expect(text()).toContain("Scan or enter the code"));
    expect(fake.companion.start).toHaveBeenCalledOnce();
    expect(fake.companion.refreshTailscale).not.toHaveBeenCalled();
    expect(text()).toContain("192.168.");
  });

  it("pairs over the tailnet when it can, with this network one tap away", async () => {
    const fake = desktop({
      enabled: true,
      tailnetName: TAILNET,
      lan: "192.168.1.34",
      endpoints: [{ kind: "tailnet", url: `http://${TAILNET}:8810`, priority: 0 }],
    });
    await mount(fake);
    await vi.waitFor(() => expect(button("Pair on this Wi-Fi instead")).not.toBeNull());
    button("Pair a device")!.click();
    await vi.waitFor(() => expect(text()).toContain("Scan or enter the code"));
    expect(fake.companion.refreshTailscale).toHaveBeenCalledOnce();
    expect(text()).toContain("mac.tail12");
  });
});
