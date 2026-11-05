import { describe, expect, it } from "vitest";

import { boatCapableEngine, isActiveTurnRefusal, isRemoteScreenshotContention } from "./remote-desktop";
import type { InstanceInfo } from "@/state/store";
import { CLOUD_COMPUTER_BUSY_ERROR } from "../../shared/computer-contention";

describe("cloud computer preview", () => {
  it("runs the cloud computer on the bot's own engine, never on a swapped-in Boat runner", () => {
    const plain = { instanceId: "plain", driverKind: "openai-compat", snapshot: { state: "available" }, capabilities: { computerMcp: false } } as InstanceInfo;
    const tools = { ...plain, instanceId: "tools", driverKind: "claude", capabilities: { computerMcp: true } } as InstanceInfo;
    expect(boatCapableEngine([plain, tools], "plain")).toBeUndefined();
    expect(boatCapableEngine([plain, tools], "tools")).toBe(tools);
    expect(boatCapableEngine([plain, { ...tools, snapshot: { state: "unavailable" } }], "tools")?.snapshot.state).toBe("unavailable");
    expect(boatCapableEngine([plain, tools])).toBeUndefined();
  });
  it("retries only known transient contention, not permanent 409 failures", () => {
    expect(isRemoteScreenshotContention({ status: 409, message: "this bot's cloud computer is being changed — wait for it to finish" })).toBe(true);
    expect(isRemoteScreenshotContention({ status: 409, message: "the VPS is being prepared — try again shortly" })).toBe(true);
    for (const message of ["VPS is not configured", "The VPS computer is not ready", "Choose Cloud computer before changing or opening this cloud computer. Auto only checks existing computer state."]) {
      expect(isRemoteScreenshotContention({ status: 409, message })).toBe(false);
    }
    expect(isRemoteScreenshotContention({ status: 503, message: "this bot's cloud computer is being changed — wait for it to finish" })).toBe(false);
  });
  it("recognises the active-turn refusal as a wait, not a fault", () => {
    const message = CLOUD_COMPUTER_BUSY_ERROR;
    expect(isActiveTurnRefusal({ status: 409, message })).toBe(true);
    expect(isActiveTurnRefusal(new Error(message))).toBe(true);
    expect(isActiveTurnRefusal({ status: 409, message: `computer: ${message}` })).toBe(true);
    expect(isActiveTurnRefusal({ status: 503, message })).toBe(false);
    expect(isActiveTurnRefusal({ status: 409, message: "this bot's cloud computer is being changed — wait for it to finish" })).toBe(false);
    expect(isActiveTurnRefusal(null)).toBe(false);
  });
});
