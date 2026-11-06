import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./version-order.ts";

describe("isNewerVersion", () => {
  it("compares release versions numerically and never reports a malformed one", () => {
    expect(isNewerVersion("v0.1.93", "0.1.92")).toBe(true);
    expect(isNewerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerVersion("v0.2.0", "0.1.99")).toBe(true);
    expect(isNewerVersion("v0.1.92", "0.1.92")).toBe(false);
    expect(isNewerVersion("v0.1.91", "0.1.92")).toBe(false);
    expect(isNewerVersion("nightly", "0.1.92")).toBe(false);
    expect(isNewerVersion("v0.1.93", "unknown")).toBe(false);
    expect(isNewerVersion("v0.1.93", "0.1.93-rc.1")).toBe(true);
    expect(isNewerVersion("v0.1.93-rc.2", "0.1.93-rc.1")).toBe(true);
    expect(isNewerVersion("v0.1.93-rc.10", "0.1.93-rc.9")).toBe(true);
    expect(isNewerVersion("v0.1.93-rc.1", "0.1.93")).toBe(false);
    expect(isNewerVersion("v0.1.93-rc.1", "0.1.93-rc.1")).toBe(false);
    expect(isNewerVersion("v0.1.93-rc.1.1", "0.1.93-rc.1")).toBe(true);
  });
});
