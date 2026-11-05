import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING, type OnboardingStatus } from "@/lib/onboarding";
import { withTourReset } from "@/lib/guided-tour";
import { dismissNotice, GROK_MOVE_NOTICE, launchNotice, markLaunchNotice, nextNotice, noticeSeen, NOTICES, SIMPLE_MODE_NOTICE, type NoticeFacts } from "./notices";

let storage: Map<string, string>, session: Map<string, string>;
beforeEach(() => {
  storage = new Map(); session = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => session.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

const record = (hintsSeen: string[] = []): OnboardingStatus => ({ ...EMPTY_ONBOARDING, completedAt: "2026-09-01", version: 1, hintsSeen });
const facts = (grok: boolean | null, simple: boolean | null): NoticeFacts =>
  ({ [GROK_MOVE_NOTICE]: grok, [SIMPLE_MODE_NOTICE]: simple });
const none = () => false;

it("is one queue: the Move from Grok Bot popup, then Simple mode", () => {
  expect(NOTICES).toEqual([GROK_MOVE_NOTICE, SIMPLE_MODE_NOTICE]);
  expect(nextNotice(facts(true, true), none)).toBe(GROK_MOVE_NOTICE);
  expect(nextNotice(facts(null, true), none), "nothing shows while an earlier one waits").toBeNull();
  expect(nextNotice(facts(false, true), none)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(facts(true, true), id => id !== SIMPLE_MODE_NOTICE)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(facts(true, true), () => true)).toBeNull();
  expect(nextNotice(facts(false, false), none)).toBeNull();
  expect(GROK_MOVE_NOTICE).toBe("grok-move-2026-11");
});

it("one notice a launch: only the one this launch showed may show again in it", () => {
  expect(nextNotice(facts(true, true), none, SIMPLE_MODE_NOTICE)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(facts(true, false), none, SIMPLE_MODE_NOTICE)).toBeNull();
  expect(nextNotice(facts(true, true), none, GROK_MOVE_NOTICE)).toBe(GROK_MOVE_NOTICE);
});

it("a launch keeps the notice it showed first for the window's session; storage that throws keeps it for the page", () => {
  expect(launchNotice()).toBeNull();
  markLaunchNotice(SIMPLE_MODE_NOTICE); markLaunchNotice(GROK_MOVE_NOTICE);
  expect(launchNotice()).toBe(SIMPLE_MODE_NOTICE);
  expect(session.get("omb.launch.notice")).toBe(SIMPLE_MODE_NOTICE);
  session.set("omb.launch.notice", "something-else");
  expect(launchNotice(), "only a notice of the list").toBeNull();
  vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  markLaunchNotice(GROK_MOVE_NOTICE);
  expect(launchNotice()).toBe(GROK_MOVE_NOTICE);
});

it("a dismissal holds on this device at once and in the workspace record for good", () => {
  const seen = record(["tour.done"]);
  expect(dismissNotice(seen, GROK_MOVE_NOTICE)).toEqual({ onboarding: { hintsSeen: ["tour.done", GROK_MOVE_NOTICE] } });
  expect(storage.get(GROK_MOVE_NOTICE)).toBe("1");
  expect(noticeSeen(record(), GROK_MOVE_NOTICE)).toBe(true);
  storage.clear();
  expect(noticeSeen(record(), GROK_MOVE_NOTICE)).toBe(false);
  expect(noticeSeen(record([GROK_MOVE_NOTICE]), GROK_MOVE_NOTICE)).toBe(true);
  expect(dismissNotice(record([GROK_MOVE_NOTICE]), GROK_MOVE_NOTICE)).toBeNull();
  expect(withTourReset(record([GROK_MOVE_NOTICE, "tour.done"]))).toEqual([GROK_MOVE_NOTICE]);
});

it("browser storage that throws still leaves the workspace record in charge", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  expect(noticeSeen(record(), GROK_MOVE_NOTICE)).toBe(false);
  expect(noticeSeen(record([GROK_MOVE_NOTICE]), GROK_MOVE_NOTICE)).toBe(true);
  expect(dismissNotice(record(), GROK_MOVE_NOTICE)).toEqual({ onboarding: { hintsSeen: [GROK_MOVE_NOTICE] } });
});
