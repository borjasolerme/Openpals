import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiChoices,
  aiWorks,
  beatsFor,
  completionPatch,
  EMPTY_ONBOARDING,
  firstRunPatch,
  hintSeen,
  hostedMember,
  spotlightsQuiet,
  hintSeenPatch,
  LOCAL_VIEWER,
  MET_CHIEF_HINT,
  resumeBeat,
  welcomeAi,
  welcomeDue,
  welcomeViewer,
  WELCOME_VERSION,
  markWelcomeFinished,
  welcomeFinishedThisLaunch,
} from "./onboarding";

const done = { completedAt: "2026-09-09T10:00:00.000Z", version: WELCOME_VERSION, reelSeen: false, hintsSeen: [] };

describe("welcomeDue", () => {
  it("waits for the server before deciding", () => {
    expect(welcomeDue(null)).toBe(false);
    expect(welcomeDue(undefined)).toBe(false);
  });

  it("shows the tour to a fresh workspace", () => {
    expect(welcomeDue({})).toBe(true);
    expect(welcomeDue({ onboarding: EMPTY_ONBOARDING })).toBe(true);
  });

  it("respects a completion at the current version", () => {
    expect(welcomeDue({ onboarding: done })).toBe(false);
  });

  it("re-shows a flow completed at an older version", () => {
    expect(welcomeDue({ onboarding: { ...done, version: WELCOME_VERSION - 1 } })).toBe(true);
  });

  it("decides who gets the tour on a fresh workspace", () => {
    const fresh = { onboarding: EMPTY_ONBOARDING };
    const cases = [
      { who: "local desktop", options: LOCAL_VIEWER, due: true },
      { who: "hosted admin", options: { hosted: true, canSave: true }, due: true },
      { who: "hosted member", options: { hosted: true, canSave: false }, due: false },
      { who: "member of a self-hosted server", options: { hosted: false, canSave: false }, due: false },
      { who: "hosted, scope unknown", options: { hosted: true }, due: false },
    ];
    for (const { who, options, due } of cases) expect(welcomeDue(fresh, options), who).toBe(due);
  });
});

describe("welcomeViewer", () => {
  it("reads the session defensively", () => {
    expect(welcomeViewer({ kind: "loopback", scopes: ["admin", "client"] })).toEqual({ hosted: false, canSave: true });
    expect(welcomeViewer({ kind: "session", scopes: ["admin", "client"], hosted: true })).toEqual({ hosted: true, canSave: true });
    expect(welcomeViewer({ kind: "session", scopes: ["client"], hosted: true })).toEqual({ hosted: true, canSave: false });
    expect(welcomeViewer({ kind: "session", scopes: ["client"] })).toEqual({ hosted: false, canSave: false });
    expect(welcomeViewer({ kind: "loopback", scopes: ["client"], trust: "service" })).toEqual({ hosted: false, canSave: false });
    expect(welcomeViewer({})).toEqual(LOCAL_VIEWER);
    expect(welcomeViewer(null)).toEqual(LOCAL_VIEWER);
    expect(welcomeViewer({ scopes: ["admin"], hosted: "yes" })).toEqual({ hosted: false, canSave: true });
  });

  it("calls only a hosted session without admin scope a hosted member", () => {
    expect(hostedMember({ hosted: true, canSave: false })).toBe(true);
    expect(hostedMember({ hosted: true, canSave: true })).toBe(false);
    expect(hostedMember({ hosted: false, canSave: false })).toBe(false);
    expect(hostedMember(LOCAL_VIEWER)).toBe(false);
    expect(hostedMember(null)).toBe(false);
    expect(spotlightsQuiet(null)).toBe(true);
    expect(spotlightsQuiet({ hosted: true, canSave: false })).toBe(true);
    expect(spotlightsQuiet({ hosted: false, canSave: false })).toBe(false);
    expect(spotlightsQuiet(LOCAL_VIEWER)).toBe(false);
  });
});

describe("connecting an AI in the welcome", () => {
  type Row = { id: string; driverKind: string; access?: string; readOnly?: boolean };
  const row = (id: string, driverKind: string, extra: Partial<Row> = {}): Row => ({ id, driverKind, ...extra });

  it("recommends a Claude account first, then a ChatGPT plan, and folds every other way under it", () => {
    const grok = row("grok", "grokAgent");
    const codex = row("codex", "codex");
    const claudeKey = row("claude-api", "claudeAgent", { access: "api" });
    const claude = row("claude", "claudeAgent");
    expect(aiChoices([grok, codex, claudeKey, claude])).toEqual({ recommended: claude, others: [grok, codex, claudeKey] });
    expect(aiChoices([grok, claudeKey, codex]).recommended).toBe(codex);
    expect(aiChoices([grok, claudeKey]).recommended).toBe(grok);
    expect(aiChoices([row("company", "claudeAgent", { readOnly: true }), grok]).recommended, "an organization's model is not a sign-in").toBe(grok);
    expect(aiChoices([])).toEqual({ recommended: undefined, others: [] });
  });

  it("recommends in the same order the new-bot default uses: then Gemini, then Grok, then the rest as listed", () => {
    const kimi = row("kimi", "kimiAgent");
    const grok = row("grok", "grokAgent");
    const antigravity = row("antigravity", "antigravityAgent");
    expect(aiChoices([kimi, grok, antigravity]).recommended).toBe(antigravity);
    expect(aiChoices([kimi, grok])).toEqual({ recommended: grok, others: [kimi] });
    expect(aiChoices([kimi, row("droid", "droidAgent")]).recommended).toBe(kimi);
  });
});

describe("the AI the welcome stands on", () => {
  type Ai = { id: string; driverKind: string; ready: boolean; aiTest?: "testing" | "passed" | "failed" | "untestable"; snapshot?: { freeFallback?: boolean } };
  const ai = (id: string, driverKind: string, extra: Partial<Ai> = {}): Ai => ({ id, driverKind, ready: true, ...extra });
  const stand = (instances: Ai[]) => {
    const found = welcomeAi(instances, (instance) => instance.ready, (instance) => instance.aiTest);
    return found && { id: found.instance.id, state: found.state };
  };

  it("is none while only OpenCode's free backup works, so the welcome still asks for the person's own AI", () => {
    const backup = ai("opencodeGo", "opencodeGo", { snapshot: { freeFallback: true }, aiTest: "passed" });
    expect(stand([backup, ai("claude", "claudeAgent", { ready: false })])).toBeNull();
    expect(stand([])).toBeNull();
  });

  it("is the best ready AI, waiting on its test, and works once it answered", () => {
    expect(stand([ai("grok", "grokAgent"), ai("claude", "claudeAgent")])).toEqual({ id: "claude", state: "testing" });
    expect(stand([ai("grok", "grokAgent"), ai("claude", "claudeAgent", { aiTest: "testing" })])).toEqual({ id: "claude", state: "testing" });
    expect(stand([ai("grok", "grokAgent"), ai("claude", "claudeAgent", { aiTest: "passed" })])).toEqual({ id: "claude", state: "passed" });
    // An AI with nothing to test it with is trusted, as before.
    expect(stand([ai("muse", "museCode", { aiTest: "untestable" })])).toEqual({ id: "muse", state: "untestable" });
    // Only those two let the welcome leave out its Connect an AI step.
    expect(["passed", "untestable", "testing", "failed"].map((state) => aiWorks({ state: state as Ai["aiTest"] & string }))).toEqual([true, true, false, false]);
    expect(aiWorks(null)).toBe(false);
  });

  it("walks past an AI that didn't answer to the next, and says so when none is left", () => {
    expect(stand([ai("grok", "grokAgent", { aiTest: "passed" }), ai("claude", "claudeAgent", { aiTest: "failed" })])).toEqual({ id: "grok", state: "passed" });
    expect(stand([ai("grok", "grokAgent"), ai("claude", "claudeAgent", { aiTest: "failed" })])).toEqual({ id: "grok", state: "testing" });
    expect(stand([ai("claude", "claudeAgent", { aiTest: "failed" }), ai("opencodeGo", "opencodeGo", { snapshot: { freeFallback: true } })]))
      .toEqual({ id: "claude", state: "failed" });
  });
});

describe("persistence patches", () => {
  it("stamps completion with the current version", () => {
    expect(completionPatch(new Date("2026-09-09T12:34:56.000Z"))).toEqual({
      onboarding: { completedAt: "2026-09-09T12:34:56.000Z", version: WELCOME_VERSION },
    });
  });

  it("adds a hint once and never writes a no-op", () => {
    expect(hintSeen(undefined, "computer")).toBe(false);
    expect(hintSeenPatch(undefined, "computer")).toEqual({ onboarding: { hintsSeen: ["computer"] } });
    const record = { ...EMPTY_ONBOARDING, hintsSeen: ["computer"] };
    expect(hintSeen(record, "computer")).toBe(true);
    expect(hintSeenPatch(record, "computer")).toBeNull();
    expect(hintSeenPatch(record, "apps")).toEqual({ onboarding: { hintsSeen: ["computer", "apps"] } });
  });

  it("marks a first run as done with this welcome, keeping every hint already seen", () => {
    const now = new Date("2026-10-27T12:00:00.000Z");
    expect(firstRunPatch(undefined, now)).toEqual({ onboarding: { completedAt: now.toISOString(), version: WELCOME_VERSION, hintsSeen: [MET_CHIEF_HINT] } });
    expect(firstRunPatch({ ...EMPTY_ONBOARDING, hintsSeen: ["computer"] }, now).onboarding.hintsSeen).toEqual(["computer", MET_CHIEF_HINT]);
    expect(firstRunPatch({ ...EMPTY_ONBOARDING, hintsSeen: [MET_CHIEF_HINT] }, now).onboarding, "already met").toEqual({ completedAt: now.toISOString(), version: WELCOME_VERSION });
    expect(completionPatch(now).onboarding, "a replay says nothing about a first chat").not.toHaveProperty("hintsSeen");
    expect(firstRunPatch({ ...EMPTY_ONBOARDING, hintsSeen: ["offer"] }, now, ["offer", "other", "other"]).onboarding.hintsSeen, "offers the welcome made")
      .toEqual(["offer", MET_CHIEF_HINT, "other"]);
  });
});

describe("the first run's screens", () => {
  it("meets the app, then the AI, the bots and the apps, then ends", () => {
    expect(beatsFor({})).toEqual(["welcome", "ai", "bots", "apps", "done"]);
  });

  it("asks where the bots live only in the desktop app on this computer", () => {
    expect(beatsFor({ place: true })).toEqual(["welcome", "place", "ai", "bots", "apps", "done"]);
  });

  it("goes straight on to the AI on a server's page after pairing it", () => {
    expect(beatsFor({ welcomed: true })).toEqual(["ai", "bots", "apps", "done"]);
  });

  it("gives a hosted place's admin only the first: their team's AI, bots and apps are set up already", () => {
    expect(beatsFor({ hosted: true, place: true })).toEqual(["welcome"]);
  });

  it("resumes the saved screen while it is offered, else starts at the first", () => {
    expect(resumeBeat(beatsFor({}), "bots")).toBe("bots");
    expect(resumeBeat(beatsFor({}), undefined)).toBe("welcome");
    expect(resumeBeat(beatsFor({}), "place")).toBe("welcome");
    expect(resumeBeat(beatsFor({ hosted: true }), "bots")).toBe("welcome");
    expect(resumeBeat(beatsFor({}), "chief" as never), "a step from the earlier welcome").toBe("welcome");
  });
});

describe("welcomeFinishedThisLaunch", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("remembers in memory that the welcome finished when browser storage is blocked", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => markWelcomeFinished()).not.toThrow();
    expect(welcomeFinishedThisLaunch()).toBe(true);
  });
});
