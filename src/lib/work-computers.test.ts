import { describe, expect, it } from "vitest";
import { sameChoice, serverHost, workChoiceLabel, workChoiceOf, workComputerState, workPatch } from "./work-computers";
import { isLendLink, lendingPhase, needsMacPermissions } from "./lending";
import { guideStatus, guideStep, newlyConnected } from "@/components/work-computer/AddComputerGuide";

const mac = (extra = {}) => ({ id: "a", name: "Mac mini", platform: "darwin" as const, online: true, busy: false, lent: true, paused: false,
  lastSeenAt: 0, lastUsedAt: null, scopes: { folders: 0, terminal: false, screen: true }, ...extra });

describe("where a bot works", () => {
  it("turns each choice into the bot's own settings, and reads them back, with Auto as Your server", () => {
    expect(workPatch({ kind: "mac", id: "a" })).toEqual({ computer: "cloud", cloudBackend: "lent", lentComputerId: "a" });
    expect(workPatch({ kind: "server" })).toEqual({ computer: "browser" });
    expect(workPatch({ kind: "other", computer: "local" })).toEqual({ computer: "local" });
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
    expect(workChoiceLabel({ kind: "other", computer: "local" })).toBe("This computer");
  });

  it("says a lent Mac's state in one word", () => {
    expect(workComputerState(mac())).toBe("online");
    expect(workComputerState(mac({ busy: true }))).toBe("busy");
    expect(workComputerState(mac({ online: false, paused: true }))).toBe("paused");
    expect(workComputerState(mac({ online: false }))).toBe("offline");
    expect(workComputerState(mac({ online: false, lent: false }))).toBe("stopped");
  });

  it("the Add a computer guide says what is missing, and sees only a computer that connected since it opened", () => {
    expect(guideStep(1)).toBe(1);
    expect(guideStep(2)).toBe(2);
    expect(guideStatus({ claimed: false, computer: null })).toBe("paste");
    expect(guideStatus({ claimed: true, computer: null })).toBe("turnOn");
    expect(guideStatus({ claimed: true, computer: { screenReady: false } })).toBe("screen");
    expect(guideStatus({ claimed: true, computer: { screenReady: true } })).toBe("ready");
    expect(guideStatus({ claimed: false, computer: { screenReady: null } })).toBe("ready");
    expect(newlyConnected([mac()], new Set(["a"]))).toBeNull();
    expect(newlyConnected([mac({ id: "b" })], new Set(["a"]))?.id).toBe("b");
    expect(newlyConnected([mac({ id: "b", online: false })], new Set())).toBeNull();
  });

  it("the lending card's badge and the macOS permission hint", () => {
    expect(lendingPhase({ paused: false, state: "off" })).toBe("off");
    expect(lendingPhase({ paused: true, state: "paused" })).toBe("paused");
    expect(lendingPhase({ paused: false, state: "online" })).toBe("online");
    expect(lendingPhase({ paused: false, state: "waiting" })).toBe("problem");
    expect(isLendLink("https://box.on.boat.dev/pair#code=M9Z4-TV4D-A72W&lend=1")).toBe(true);
    expect(isLendLink("https://box.on.boat.dev/pair#code=M9Z4-TV4D-A72W")).toBe(false);
    expect(needsMacPermissions({ platform: "darwin", lendsScreen: true, screen: { ready: false, lent: true, reason: "permissions", fix: "allow" } })).toBe(true);
    expect(needsMacPermissions({ platform: "win32", lendsScreen: true, screen: { ready: false, lent: false, reason: "permissions", fix: "allow" } })).toBe(false);
  });
});

it("names Boat as the host of a server on an on.boat.dev address, and nothing else", () => {
  expect(serverHost("box-node-a25322d3423c1bce-8799.on.boat.dev")).toBe("Boat");
  expect(serverHost("127.0.0.1")).toBeNull();
  expect(serverHost("boat.dev.example.com")).toBeNull();
});
