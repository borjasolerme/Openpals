import { describe, expect, it } from "vitest";

import { computerStartLine } from "./computer-start";

describe("computerStartLine", () => {
  it("names the bot's cloud computer while it is created or woken", () => {
    expect(computerStartLine({ state: "provisioning" }, "Scout"))
      .toBe("Starting Scout's cloud desktop. The first start takes about a minute.");
    expect(computerStartLine({ state: "waking" }, "Scout")).toBe("Waking Scout's cloud desktop…");
  });

  it("shows nothing when nothing is starting", () => {
    expect(computerStartLine(undefined, "Scout")).toBeNull();
  });
});
