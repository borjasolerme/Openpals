import { describe, expect, it } from "vitest";

import { HOST_WHILE_UPDATING, vpsDesktopOutdated, withoutHostWhileUpdating } from "./vps-hints.ts";

describe("vpsDesktopOutdated", () => {
  it("is true only for this bot's own VPS container on an image this release no longer runs", () => {
    const old = { configured: true, daemonUp: true, container: "running", managed: true, imageMatches: false };
    expect(vpsDesktopOutdated(old)).toBe(true);
    expect(vpsDesktopOutdated({ ...old, imageMatches: true })).toBe(false);
    expect(vpsDesktopOutdated({ ...old, container: "missing" })).toBe(false);
    expect(vpsDesktopOutdated({ ...old, managed: false })).toBe(false);
    expect(vpsDesktopOutdated({ ...old, daemonUp: false })).toBe(false);
    expect(vpsDesktopOutdated(null)).toBe(false);
  });
});

describe("withoutHostWhileUpdating", () => {
  it("takes this computer off the choices only while the bot's own desktop awaits its update", () => {
    const options = [
      { surface: "cloud", available: true, ready: false, canStart: true, canCreate: false },
      { surface: "local", available: true, ready: true, canStart: false, canCreate: false },
    ];
    expect(withoutHostWhileUpdating(options, false)).toBe(options);
    expect(withoutHostWhileUpdating(options, true)).toEqual([
      options[0],
      { surface: "local", available: false, ready: false, canStart: false, canCreate: false, reason: HOST_WHILE_UPDATING },
    ]);
  });
});
