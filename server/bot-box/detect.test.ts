import { describe, expect, it } from "vitest";

import { boxWanted, detectBox } from "./detect.ts";

const tools = (found: Record<string, string>) => (name: string) => found[name] ?? null;

describe("deciding whether turns are boxed", () => {
  it("is off unless OMB_BOT_BOX asks for it", () => {
    expect(boxWanted({})).toBe(false);
    expect(boxWanted({ OMB_BOT_BOX: "0" })).toBe(false);
    expect(boxWanted({ OMB_BOT_BOX: "off" })).toBe(false);
    expect(boxWanted({ OMB_BOT_BOX: "1" })).toBe(true);
    expect(boxWanted({ OMB_BOT_BOX: "bwrap" })).toBe(true);
    const working = { platform: "linux" as const, probe: () => true, which: tools({ bwrap: "/usr/bin/bwrap", socat: "/usr/bin/socat" }) };
    expect(detectBox({ env: {}, ...working })).toEqual({ box: "off", reason: "switched-off", tools: null });
    expect(detectBox({ env: { OMB_BOT_BOX: "1" }, ...working })).toEqual({ box: "bwrap", reason: null, tools: { bwrap: "/usr/bin/bwrap", socat: "/usr/bin/socat" } });
  });

  it("never runs unboxed turns by surprise: no bwrap, a refusing kernel or another platform report off with the reason", () => {
    const env = { OMB_BOT_BOX: "1" };
    expect(detectBox({ env, platform: "darwin", probe: () => true, which: tools({ bwrap: "/x" }) })).toEqual({ box: "off", reason: "not-linux", tools: null });
    expect(detectBox({ env, platform: "linux", probe: () => true, which: tools({}) })).toEqual({ box: "off", reason: "no-bwrap", tools: null });
    expect(detectBox({ env, platform: "linux", probe: () => false, which: tools({ bwrap: "/usr/bin/bwrap" }) })).toEqual({ box: "off", reason: "userns-refused", tools: null });
    expect(detectBox({ env, platform: "linux", probe: () => true, which: tools({ bwrap: "/usr/bin/bwrap" }) }).tools).toEqual({ bwrap: "/usr/bin/bwrap", socat: null });
  });
});
