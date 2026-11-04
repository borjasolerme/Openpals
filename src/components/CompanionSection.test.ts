import { describe, expect, it } from "vitest";

import {
  companionStateRefreshIsCurrent,
  mutateCompanionBridgeState,
  phonePairingManualCodeMode,
} from "../lib/companion-state";
import type { CompanionState } from "./PhoneSetupFlow";
import {
  deriveCompanionPanelStatus,
  deriveTailscalePairingStatus,
  pairingSurfaceCopy,
} from "./CompanionSection";

describe("companion status refresh", () => {
  it("omits the redundant status pill when device access is ready for its first pairing", () => {
    expect(deriveCompanionPanelStatus({
      enabled: true,
      devices: [],
    })).toBeNull();
  });

  it("does not show a healthy status when the enabled sidecar reports an error", () => {
    expect(deriveCompanionPanelStatus({
      enabled: true,
      devices: [],
      error: "sidecar stopped responding",
    })).toEqual({ label: "Remote access needs attention", good: false });
  });

  it("does not let a pre-mutation poll overwrite a newly opened pairing", async () => {
    const pairingToken = `omb_pair_${"a".repeat(43)}`;
    const staleState: CompanionState = {
      enabled: true,
      keepAwake: false,
      port: 8811,
      devices: [],
      pairing: null,
    };
    const pairedState: CompanionState = {
      ...staleState,
      pairing: { code: "004209", token: pairingToken, expiresAt: Date.now() + 60_000 },
    };
    let releaseStaleRead = () => {};
    const staleRead = new Promise<void>((resolve) => {
      releaseStaleRead = resolve;
    });
    const epoch = { current: 0 };
    const refreshEpoch = epoch.current;
    let visibleState: CompanionState | null = null;
    const refresh = staleRead.then(() => {
      if (companionStateRefreshIsCurrent(epoch, refreshEpoch)) visibleState = staleState;
    });

    visibleState = await mutateCompanionBridgeState(epoch, () => Promise.resolve(pairedState));
    releaseStaleRead();
    await refresh;

    expect(visibleState).toBe(pairedState);
    expect(epoch.current).toBe(2);
  });
});

describe("manual pairing code placement", () => {
  it("shows the code directly when no QR link can be built", () => {
    expect(phonePairingManualCodeMode(true, null)).toBe("direct");
  });

  it("keeps the code in troubleshooting details when a QR is available", () => {
    expect(phonePairingManualCodeMode(true, "openmausbot://pair?token=example")).toBe("details");
    expect(phonePairingManualCodeMode(false, null)).toBe("hidden");
  });
});

describe("Tailscale pairing onboarding", () => {
  it("names the surface after the route the flow pairs over", () => {
    expect(pairingSurfaceCopy({ route: "tailscale" }).title).toBe("Tailscale pairing");
    expect(pairingSurfaceCopy({ route: "local" }).title).toBe("Direct Wi-Fi pairing");
  });

  it("explains every step between unchecked and ready", () => {
    expect(deriveTailscalePairingStatus({ enabled: false }, false)).toMatchObject({
      kind: "unchecked",
      detail: expect.stringContaining("turns on Remote access"),
    });
    expect(deriveTailscalePairingStatus({ enabled: true }, false).kind).toBe("unavailable");
    expect(deriveTailscalePairingStatus({
      enabled: true,
      tailscale: "100.99.1.2",
    }, false).kind).toBe("magicdns");
    expect(deriveTailscalePairingStatus({
      enabled: true,
      tailscale: "100.99.1.2",
      tailnetName: "mac.tail1234.ts.net",
    }, true)).toMatchObject({
      kind: "ready",
      title: "Ready on mac.tail1234.ts.net",
    });
  });

  it("surfaces sidecar failures instead of pretending Tailscale is merely absent", () => {
    expect(deriveTailscalePairingStatus({
      enabled: true,
      error: "the companion is not responding",
    }, false)).toEqual({
      kind: "error",
      title: "Remote access needs attention",
      detail: "the companion is not responding",
    });
  });
});
