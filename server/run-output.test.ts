import { describe, expect, it } from "vitest";

import { clipRunOutput, keptRunOutput } from "./run-output.ts";

describe("clipRunOutput", () => {
  const long = "Checked everything. ".repeat(200);

  it("leaves a short reply alone and cuts a long one with no closing question", () => {
    expect(clipRunOutput("Short.\nNEEDS INPUT: Go?", 2_000)).toBe("Short.\nNEEDS INPUT: Go?");
    expect(clipRunOutput(long, 2_000)).toBe(long.slice(0, 2_000));
  });

  it("keeps a closing question, and its default line, whole at the end", () => {
    const clipped = clipRunOutput(`${long}\nNEEDS INPUT: Send it?`, 2_000);
    expect(clipped.length).toBeLessThanOrEqual(2_000);
    expect(clipped.endsWith("\n…\nNEEDS INPUT: Send it?")).toBe(true);
    expect(clipRunOutput(`${long}\nNEEDS INPUT: Send it?\n\ndefault: wait`, 2_000).endsWith("NEEDS INPUT: Send it?\n\ndefault: wait")).toBe(true);
  });

  it("does not move a question from the middle to the end", () => {
    const text = `NEEDS INPUT: old?\n${long}`;
    expect(clipRunOutput(text, 2_000)).toBe(text.slice(0, 2_000));
    expect(clipRunOutput(`${long}\nNEEDS INPUT: Go?\nMore text after it.`, 2_000)).toBe(`${long}\nNEEDS INPUT: Go?\nMore text after it.`.slice(0, 2_000));
  });

  it("keeps a long closing question that fits, and cuts one too long on its own line", () => {
    const question = `NEEDS INPUT: ${"why ".repeat(300)}?`;
    const kept = clipRunOutput(`${long}\n${question}`, 2_000);
    expect(kept.length).toBeLessThanOrEqual(2_000);
    expect(kept.endsWith(`\n…\n${question}`)).toBe(true);
    const cut = clipRunOutput(`${long}\nNEEDS INPUT: ${"why ".repeat(600)}?\ndefault: wait`, 2_000);
    expect(cut.length).toBe(2_000);
    expect(cut.startsWith("NEEDS INPUT: why")).toBe(true);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("keeps the default line of a bare NEEDS INPUT line too long to fit", () => {
    const cut = clipRunOutput(`${long}\nNEEDS INPUT:\ndefault: ${"wait ".repeat(500)}`, 2_000);
    expect(cut.length).toBe(2_000);
    expect(cut.startsWith("NEEDS INPUT:\ndefault: wait")).toBe(true);
  });

  it("keeps the default line of a bare NEEDS INPUT line when blank lines separate them", () => {
    const cut = clipRunOutput(`${long}\nNEEDS INPUT:\n${"\n".repeat(2_000)}default: ${"wait ".repeat(500)}`, 2_000);
    expect(cut.length).toBe(2_000);
    expect(cut.startsWith("NEEDS INPUT:\ndefault: wait")).toBe(true);
    expect(clipRunOutput(`${long}\nNEEDS INPUT:\n${" ".repeat(2_000)}default: wait`, 2_000)).toBe("NEEDS INPUT:\ndefault: wait…");
  });
});

describe("keptRunOutput", () => {
  it("keeps the report already delivered when a later item says nothing", () => {
    expect(keptRunOutput("The invoice is issued.", "", 2_000)).toBe("The invoice is issued.");
    expect(keptRunOutput("The invoice is issued.", "Now it is filed.", 2_000)).toBe("Now it is filed.");
    expect(keptRunOutput(undefined, "", 2_000)).toBeUndefined();
  });
});
