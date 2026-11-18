import { describe, expect, it } from "vitest";

import { chosenPlace, pickComputer, type ComputerOption } from "./computer-selection.ts";

const option = (surface: ComputerOption["surface"], state: "ready" | "asleep" | "missing" | "off"): ComputerOption => ({
  surface,
  available: state !== "off",
  ready: state === "ready",
  canStart: state === "asleep",
  canCreate: state === "missing",
});

describe("which computer select_computer picks", () => {
  // A Works on: Cloud computer turn before its first computer call: the
  // cloud computer is missing or asleep, and the built-in browser is ready.
  const offered = (cloud: "asleep" | "missing") => [option("cloud", cloud), option("local", "off"), option("browser", "ready")];

  it("keeps the cloud computer this turn starts on its first call: asking for it or for Auto never moves the request", () => {
    for (const cloud of ["asleep", "missing"] as const) {
      for (const requested of ["cloud", "auto"] as const) {
        const picked = pickComputer(offered(cloud), requested, "cloud", true);
        expect(picked.option?.surface).toBe("cloud");
        expect(picked.current).toBe(true);
      }
    }
  });

  it("switches away from a current computer that is not up and not this turn's to start", () => {
    // A failed start, or a desktop only leased once it is up.
    const auto = pickComputer(offered("asleep"), "auto", "cloud", false);
    expect(auto.option?.surface).toBe("browser");
    expect(auto.current).toBe(false);
    const cloud = pickComputer(offered("asleep"), "cloud", "cloud", false);
    expect(cloud.option?.surface).toBe("cloud");
    expect(cloud.current).toBe(false);
  });

  it("keeps a ready current computer, and moves to another when asked", () => {
    const options = [option("cloud", "ready"), option("browser", "ready")];
    expect(pickComputer(options, "auto", "cloud", false)).toMatchObject({ option: { surface: "cloud" }, current: true });
    expect(pickComputer(options, "browser", "cloud", true)).toMatchObject({ option: { surface: "browser" }, current: false });
  });

  it("on Auto with nothing current prefers anything ready, then one it can start, then one it can create", () => {
    expect(pickComputer([option("cloud", "asleep"), option("browser", "ready")], "auto", "off", false).option?.surface).toBe("browser");
    expect(pickComputer([option("cloud", "asleep"), option("local", "off")], "auto", "off", false).option?.surface).toBe("cloud");
    expect(pickComputer([option("cloud", "missing"), option("browser", "off")], "auto", "off", false).option?.surface).toBe("cloud");
    expect(pickComputer([option("cloud", "off")], "auto", "off", false).option).toBeUndefined();
  });

  it("on Auto keeps the place the person chose while it can be had, even when another computer is up, and moves only when asked", () => {
    const options = [option("cloud", "missing"), option("local", "ready"), option("browser", "ready")];
    expect(pickComputer(options, "auto", "off", false, "cloud")).toMatchObject({ option: { surface: "cloud" }, current: false });
    expect(pickComputer([option("cloud", "asleep"), option("local", "ready")], "auto", "off", false, "cloud").option?.surface).toBe("cloud");
    expect(pickComputer(options, "local", "off", false, "cloud").option?.surface).toBe("local");
    // A chosen place that cannot be had at all leaves Auto its usual pick.
    expect(pickComputer([option("cloud", "missing"), option("browser", "off")], "auto", "off", false, "browser").option?.surface).toBe("cloud");
    expect(pickComputer(options, "auto", "cloud", true, "cloud")).toMatchObject({ option: { surface: "cloud" }, current: true });
  });
});

describe("the place a person chose", () => {
  it("is their pin in the conversation, else the bot's Works on, and never a pin a turn made or Auto/Off", () => {
    expect(chosenPlace({ surface: "local", surfaceSource: "user" }, "cloud")).toBe("local");
    expect(chosenPlace({ surface: "local" }, undefined)).toBe("local");
    expect(chosenPlace({ surface: "cloud", surfaceSource: "auto" }, "local")).toBe("local");
    expect(chosenPlace({ surface: "cloud", surfaceSource: "auto" }, undefined)).toBeUndefined();
    expect(chosenPlace(undefined, "off")).toBeUndefined();
    expect(chosenPlace(undefined, "browser")).toBe("browser");
  });
});
