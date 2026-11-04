import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { moveLine, moveQuietUntil, MOVE_QUIET_MS } from "./cloud-send";

beforeEach(() => { setLocale("en"); });
afterEach(() => { setLocale("en"); });

describe("the one-time move's line", () => {
  it("names the server of the person's own it goes to, with Try again after a day of failing", () => {
    const place = "Garage server";
    expect(moveLine({ phase: "copy", place })).toEqual({ kind: "sending", text: "Moving your bots to Garage server…", extra: [], place });
    expect(moveLine({ phase: "copy", chats: { done: 3, total: 9 }, place })?.text).toBe("Moving your bots to Garage server… 3 of 9 chats");
    expect(moveLine({ phase: "wait", waitingFor: "Scout", place })?.text).toBe("Moving your bots to Garage server… waiting for Scout to finish");
    expect(moveLine({ phase: "wait", waitingFor: "", waitingWhat: "sign-in", place })?.text).toBe("Moving your bots to Garage server… waiting for a sign-in to finish");
    expect(moveLine({ phase: "wait", waitingFor: "", place })?.text).toBe("Moving your bots to Garage server… waiting for your bots to finish");
    expect(moveLine({ phase: "finishing", place })?.text).toBe("Moving to Garage server… almost done");
    expect(moveLine({ phase: "copy", updating: true, place })?.text).toBe("Update Openpals on Garage server. Your bots move there once it's updated.");
    expect(moveLine({ phase: "copy", failing: { error: "Garage server has other people on it now, so your bots can't move there." }, place }))
      .toMatchObject({ kind: "failed", text: "Your bots couldn't move to Garage server yet: Garage server has other people on it now, so your bots can't move there.", retry: true, place });
    expect(moveLine({ phase: "finishing", failing: { error: null }, place })).toMatchObject({ kind: "failed", text: "Your bots couldn't move to Garage server yet.", retry: true });
  });

  it("says nothing once done, nor without a server to name", () => {
    expect(moveLine({ phase: "done", phone: true, place: "Garage server" })).toBeNull();
    expect(moveLine({ phase: "copy" })).toBeNull();
  });
});

describe("how long the corner cards wait for the move", () => {
  it("for good while it goes, and a while after it is done", () => {
    expect(moveQuietUntil(null)).toBe(0);
    expect(moveQuietUntil({ phase: "copy", place: "Garage server" })).toBe(Infinity);
    expect(moveQuietUntil({ phase: "done", phone: false, at: 1_000 })).toBe(1_000 + MOVE_QUIET_MS);
    expect(moveQuietUntil({ phase: "done", phone: false })).toBe(0);
  });
});
