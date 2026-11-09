import { describe, expect, it } from "vitest";

import { outsideDriven } from "./outside-driven.ts";

describe("outsideDriven", () => {
  it("calls a conversation outside-driven when a webhook started it, posted into it, or drove the work handed to it", () => {
    const records = (overrides: Partial<Parameters<typeof outsideDriven>[1]> = {}) => ({
      marked: (id: string) => id === "kept", webhookRun: (id: string) => id === "hook-run", webhookPosted: (id: string) => id === "updates", handedFrom: () => [] as string[], ...overrides,
    });
    expect(outsideDriven("chat", records())).toBe(false);
    expect(outsideDriven("hook-run", records())).toBe(true);
    expect(outsideDriven("updates", records())).toBe(true);
    expect(outsideDriven("kept", records())).toBe(true);
    expect(outsideDriven("teammate", records({ handedFrom: () => ["kept"] }))).toBe(true);
    expect(outsideDriven("teammate", records({ handedFrom: () => ["chat", "hook-run"] }))).toBe(true);
    expect(outsideDriven("teammate", records({ handedFrom: () => ["chat"] }))).toBe(false);
  });
});
