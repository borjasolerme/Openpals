import { describe, expect, it } from "vitest";
import { sameChoice, workChoiceLabel, workChoiceOf, workComputerState, workPatch } from "./work-computers";
import { lendingPhase, needsMacPermissions } from "./lending";
import { guideStep, newlyConnected } from "@/components/work-computer/AddMacGuide";

const mac = (extra = {}) => ({ id: "a", name: "Mac mini", platform: "darwin" as const, online: true, busy: false, lent: true, paused: false,
  lastSeenAt: 0, lastUsedAt: null, scopes: { folders: 0, terminal: false, screen: true }, ...extra });

describe("where a bot works", () => {
  it("turns each choice into the bot's own settings, and reads them back, with Auto as Your server", () => {
    expect(workPatch({ kind: "mac", id: "a" })).toEqual({ computer: "cloud", cloudBackend: "lent", lentComputerId: "a" });
    expect(workPatch({ kind: "server" })).toEqual({ computer: "browser" });
    expect(workPatch({ kind: "other", computer: "vm" })).toEqual({ computer: "vm" });
    expect(workChoiceOf({ computer: "cloud", cloudBackend: "lent", lentComputerId: "a" })).toEqual({ kind: "mac", id: "a" });
    expect(workChoiceOf({ computer: "browser" })).toEqual({ kind: "server" });
    expect(workChoiceOf({})).toEqual({ kind: "server" });
    expect(workChoiceOf({ computer: "cloud" })).toEqual({ kind: "other", computer: "cloud" });
    expect(workChoiceOf({ computer: "off" })).toEqual({ kind: "other", computer: "off" });
    expect(sameChoice({ kind: "mac", id: "a" }, { kind: "mac", id: "b" })).toBe(false);
    expect(sameChoice({ kind: "server" }, { kind: "server" })).toBe(true);
  });

  it("names a place in plain words: Your server, a lent computer by its own name", () => {
    expect(workChoiceLabel({ kind: "server" })).toBe("Your server");
    expect(workChoiceLabel({ kind: "mac", id: "a" }, [{ id: "a", name: "Mac mini" }])).toBe("Mac mini");
    expect(workChoiceLabel({ kind: "mac", id: "gone" })).toBe("A computer of yours");
    expect(workChoiceLabel({ kind: "other", computer: "vm" })).toBe("Private desktop");
  });

  it("says a lent Mac's state in one word", () => {
    expect(workComputerState(mac())).toBe("online");
    expect(workComputerState(mac({ busy: true }))).toBe("busy");
    expect(workComputerState(mac({ online: false, paused: true }))).toBe("paused");
    expect(workComputerState(mac({ online: false }))).toBe("offline");
    expect(workComputerState(mac({ online: false, lent: false }))).toBe("stopped");
  });

  it("the Add a Mac guide moves on as each step is done, and sees only a Mac that connected since it opened", () => {
    expect(guideStep({ reached: 1, link: false, connected: false })).toBe(1);
    expect(guideStep({ reached: 2, link: false, connected: false })).toBe(2);
    expect(guideStep({ reached: 2, link: true, connected: false })).toBe(3);
    expect(guideStep({ reached: 1, link: false, connected: true })).toBe(4);
    expect(newlyConnected([mac()], new Set(["a"]))).toBeNull();
    expect(newlyConnected([mac({ id: "b" })], new Set(["a"]))?.id).toBe("b");
    expect(newlyConnected([mac({ id: "b", online: false })], new Set())).toBeNull();
  });

  it("the lending card's badge and the macOS permission hint", () => {
    expect(lendingPhase({ on: false, paused: false, state: "off" })).toBe("off");
    expect(lendingPhase({ on: true, paused: true, state: "paused" })).toBe("paused");
    expect(lendingPhase({ on: true, paused: false, state: "online" })).toBe("online");
    expect(lendingPhase({ on: true, paused: false, state: "waiting" })).toBe("problem");
    expect(needsMacPermissions({ platform: "darwin", lendsScreen: true, screen: { ready: false, lent: true, reason: "permissions", fix: "allow" } })).toBe(true);
    expect(needsMacPermissions({ platform: "win32", lendsScreen: true, screen: { ready: false, lent: false, reason: "permissions", fix: "allow" } })).toBe(false);
  });
});
