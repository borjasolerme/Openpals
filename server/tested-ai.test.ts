import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelSelection, ProviderSnapshot } from "./contracts.ts";
import { selectDefaultModelSelection, type SelectableInstance } from "./default-model-selection.ts";
import type { CheckableEngine } from "./engine-check.ts";
import { backgroundAiChecks, configIdentity, createTestedAi, type TestedAiDeps } from "./tested-ai.ts";

const MINUTE = 60_000;
const ready = (instanceId: string, driverKind: string, snapshot: Partial<ProviderSnapshot> = {}): SelectableInstance => ({
  instanceId, driverKind, snapshot: { state: "available", authenticated: true, ...snapshot },
  models: { default: `${instanceId}-model`, options: [{ id: `${instanceId}-model`, label: instanceId }] },
});
const on = (instanceId: string): ModelSelection => ({ instanceId, model: `${instanceId}-model` });
const silent = async (): Promise<string> => { throw new Error("529 overloaded"); };

describe("testing an AI with one tiny message before a new bot's default trusts it", () => {
  let instances: SelectableInstance[];
  let answers: Record<string, () => Promise<string>>;
  let engines: Map<string, CheckableEngine>;
  let saved: ModelSelection | undefined;
  let profile: ModelSelection | undefined;
  let pick: ModelSelection;
  let clock: number;
  let timers: Array<{ at: number; run: () => void; cancelled: boolean }>;
  let data: string;
  let company: (instanceId: string) => boolean;
  let tested: ReturnType<typeof createTestedAi>;

  const engineFor = (instanceId: string): CheckableEngine => {
    let engine = engines.get(instanceId);
    if (!engine) {
      engine = { instanceId, displayName: instanceId, driverKind: instanceId, generateText: vi.fn(() => answers[instanceId]!()) };
      engines.set(instanceId, engine);
    }
    return engine;
  };
  const sent = (instanceId: string) => vi.mocked(engines.get(instanceId)?.generateText)?.mock.calls.length ?? 0;
  // What server/index.ts does on every read of the engines: choose, then let the tests settle the choice.
  const refresh = (read = tested.read()) => {
    pick = tested.settle(selectDefaultModelSelection(instances, saved, { answered: tested.answered, company }), instances, read);
    return pick;
  };
  const make = (extra: Partial<TestedAiDeps> = {}) => createTestedAi({
    engine: (instanceId) => engineFor(instanceId),
    saved: () => [saved, profile],
    hosted: () => false,
    context: { company: (instanceId) => company(instanceId) },
    changed: async () => refresh(),
    background: true,
    file: join(data, "ai-checks.json"),
    now: () => clock,
    after: (ms, run) => {
      const timer = { at: clock + ms, run, cancelled: false };
      timers.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
    ...extra,
  });
  const settled = () => vi.waitFor(() => expect(tested.testing()).toBe(false));
  /** Time passes: due retries fire, and their tests finish. */
  const wait = async (ms: number) => {
    clock += ms;
    for (const timer of timers.splice(0)) {
      if (timer.cancelled) continue;
      if (timer.at <= clock) timer.run();
      else timers.push(timer);
    }
    await settled();
  };
  /** A start: read the engines, as server/index.ts does. */
  const boot = async () => {
    refresh();
    await settled();
  };

  beforeEach(() => {
    instances = [ready("grok", "grokAgent"), ready("claude", "claudeAgent")];
    answers = { claude: async () => "OK", grok: async () => "OK", opencodeGo: async () => "OK" };
    engines = new Map();
    saved = undefined;
    profile = undefined;
    clock = 1_000_000;
    timers = [];
    company = () => false;
    data = mkdtempSync(join(tmpdir(), "omb-tested-ai-"));
    tested = make();
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(data, { recursive: true, force: true });
  });

  it("picks by ranking at once, tests the pick in the background, and keeps it when it answers", async () => {
    refresh();
    expect(pick).toEqual(on("claude"));
    expect(tested.state(instances[1]!)).toBe("testing");
    await settled();
    expect(tested.state(instances[1]!)).toBe("passed");
    expect(sent("claude")).toBe(1);
    expect(sent("grok")).toBe(0);
    expect(pick).toEqual(on("claude"));
  });

  it("doesn't demote an AI for one missed test: it tries again in two minutes and keeps its place", async () => {
    answers.claude = silent;
    await boot();
    expect(tested.state(instances[1]!)).toBe("failed");
    expect(tested.answered(instances[1]!)).toBeUndefined();
    expect(pick).toEqual(on("claude"));
    expect(sent("grok")).toBe(0);
    answers.claude = async () => "OK";
    await wait(2 * MINUTE);
    expect(sent("claude")).toBe(2);
    expect(tested.state(instances[1]!)).toBe("passed");
    expect(pick).toEqual(on("claude"));
  });

  it("after two misses in a row moves the default to the next AI", async () => {
    answers.claude = silent;
    let grokAnswers!: (text: string) => void;
    answers.grok = () => new Promise<string>((resolve) => { grokAnswers = resolve; });
    await boot();
    clock += 2 * MINUTE;
    for (const timer of timers.splice(0)) timer.run();
    await vi.waitFor(() => expect(tested.answered(instances[1]!)).toBe(false));
    expect(tested.state(instances[1]!)).toBe("failed");
    // The default goes to the next AI at once, and that AI is tested next.
    await vi.waitFor(() => expect(tested.state(instances[0]!)).toBe("testing"));
    expect(pick).toEqual(on("grok"));
    grokAnswers("OK");
    await settled();
    expect(tested.state(instances[0]!)).toBe("passed");
  });

  it("keeps the default on the AI that answered while one that didn't is being tried again", async () => {
    instances = [ready("claude", "claudeAgent"), ready("opencodeGo", "opencodeGo", { freeFallback: true })];
    answers.claude = silent;
    await boot();
    await wait(2 * MINUTE);
    expect(pick).toEqual(on("opencodeGo"));
    let claudeAnswers!: (text: string) => void;
    answers.claude = () => new Promise<string>((resolve) => { claudeAnswers = resolve; });
    clock += 10 * MINUTE;
    for (const timer of timers.splice(0)) timer.run();
    await vi.waitFor(() => expect(tested.state(instances[0]!)).toBe("testing"));
    expect(refresh()).toEqual(on("opencodeGo"));
    claudeAnswers("OK");
    await settled();
    expect(pick).toEqual(on("claude"));
  });

  it("keeps trying an AI that missed three times, once an hour", async () => {
    answers.claude = silent;
    await boot();
    await wait(2 * MINUTE);
    await wait(10 * MINUTE);
    expect(sent("claude")).toBe(3);
    await wait(59 * MINUTE);
    expect(sent("claude"), "not before the hour").toBe(3);
    await wait(MINUTE);
    expect(sent("claude")).toBe(4);
    answers.claude = async () => "OK";
    await wait(60 * MINUTE);
    expect(sent("claude")).toBe(5);
    expect(pick).toEqual(on("claude"));
  });

  it("keeps a passing result across a restart for a day, so a start sends no test message", async () => {
    await boot();
    expect(sent("claude")).toBe(1);
    engines = new Map();
    tested = make();
    refresh();
    await settled();
    expect(sent("claude")).toBe(0);
    expect(tested.state(instances[1]!)).toBe("passed");
    clock += 24 * 60 * MINUTE;
    engines = new Map();
    tested = make();
    refresh();
    await settled();
    expect(sent("claude")).toBe(1);
  });

  it("tests again when the engine's own settings change, as a new key would", async () => {
    let identity = "key-1";
    tested = make({ identity: () => identity });
    await boot();
    identity = "key-2";
    clock += 6 * MINUTE;
    refresh();
    await settled();
    expect(sent("claude")).toBe(2);
    expect(configIdentity({ driver: "claudeAgent", environment: { KEY: "a" } })).not.toBe(configIdentity({ driver: "claudeAgent", environment: { KEY: "b" } }));
    const named = (displayName: string) => ({ driver: "claudeAgent", displayName });
    expect(configIdentity(named("One"))).toBe(configIdentity(named("Two")));
  });

  it("never tests or moves a default the person saved, in Settings or as the New Bot defaults' model", async () => {
    for (const keep of [() => { saved = on("claude"); }, () => { profile = on("claude"); }]) {
      saved = undefined;
      profile = undefined;
      keep();
      engines = new Map();
      answers.claude = silent;
      tested = make();
      await boot();
      await wait(10 * MINUTE);
      expect(engines.size).toBe(0);
    }
  });

  it("tests the person's own AIs in the order the default picks them, and never an organization's or the trial credit", async () => {
    company = (instanceId) => instanceId === "company.claude";
    instances = [ready("company.claude", "claudeAgent"), ready("grok", "grokAgent")];
    await boot();
    expect(sent("grok")).toBe(1);
    expect(sent("company.claude")).toBe(0);
    instances = [ready("company.claude", "claudeAgent")];
    clock += 6 * MINUTE;
    refresh();
    await settled();
    expect(sent("company.claude")).toBe(0);
  });

  it("lets only the latest read of the engines settle anything", async () => {
    await boot();
    const older = tested.read();
    instances = [ready("grok", "grokAgent")];
    expect(refresh()).toEqual(on("grok"));
    await settled();
    const before = engines.size;
    // A slow read that started first finishes last, with an AI nobody has tested: it neither changes the pick nor tests it.
    instances = [ready("claude-work", "claudeAgent"), ready("grok", "grokAgent"), ready("claude", "claudeAgent")];
    expect(refresh(older)).toEqual(on("grok"));
    expect(tested.testing()).toBe(false);
    expect(engines.size).toBe(before);
  });

  it("counts a test that hangs past its time as a miss, and holds nothing open", async () => {
    vi.useFakeTimers();
    tested = make({ timeoutMs: 30_000, after: undefined });
    answers.claude = () => new Promise<string>(() => {});
    refresh();
    expect(tested.state(instances[1]!)).toBe("testing");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tested.state(instances[1]!)).toBe("failed");
    expect(tested.testing()).toBe(false);
    // Only the retry in two minutes is left, and it doesn't keep the process alive.
    expect(vi.getTimerCount()).toBe(1);
  });

  it("tests an AI whose status keeps changing at most once in five minutes in the background", async () => {
    instances = [ready("claude", "claudeAgent")];
    await boot();
    for (const account of [undefined, { email: "person@example.test" }, undefined]) {
      clock += MINUTE;
      instances = [ready("claude", "claudeAgent", account ? { account } : { authenticated: undefined })];
      refresh();
      await settled();
    }
    expect(sent("claude")).toBe(1);
    clock += 5 * MINUTE;
    refresh();
    await settled();
    expect(sent("claude")).toBe(2);
  });

  it("checks one AI on request, sharing a test already under way, and live every other time", async () => {
    const live = { ...engineFor("claude"), snapshot: async () => instances[1]!.snapshot };
    refresh();
    await expect(tested.check(live)).resolves.toEqual({ ok: true });
    expect(sent("claude")).toBe(1);
    expect(tested.info(instances[1]!)).toEqual({ aiTest: "passed" });
    expect(tested.info(instances[0]!)).toEqual({});
    // Check again: a sign-out the last status read hasn't seen yet still shows, with the reason.
    answers.claude = async () => { throw new Error("Not logged in · Please run /login"); };
    await expect(tested.check(live)).resolves.toMatchObject({ ok: false });
    expect(tested.info(instances[1]!)).toEqual({ aiTest: "failed", aiTestError: "claude isn't signed in on this computer anymore. Sign in again, then check again." });
  });

  it("sends nothing in the background where it is switched off, and still checks on request", async () => {
    tested = make({ background: false });
    await boot();
    expect(engines.size).toBe(0);
    await expect(tested.check({ ...engineFor("grok"), snapshot: async () => instances[0]!.snapshot })).resolves.toEqual({ ok: true });
  });

  it("writes its record where it was told, and starts clean from a broken one", async () => {
    await boot();
    expect(JSON.parse(readFileSync(join(data, "ai-checks.json"), "utf8"))).toMatchObject({ results: { claude: { state: "passed" } } });
    writeFileSync(join(data, "ai-checks.json"), "{not json");
    engines = new Map();
    tested = make();
    refresh();
    await settled();
    expect(sent("claude")).toBe(1);
  });
});

describe("test messages in the background", () => {
  it("are on unless OMB_AI_CHECKS=0, and under vitest only when a test asks for them, so fake engines log only the turns a test sends", () => {
    expect(backgroundAiChecks({})).toBe(true);
    expect(backgroundAiChecks({ OMB_AI_CHECKS: "0" })).toBe(false);
    expect(backgroundAiChecks({ OMB_AI_CHECKS: " 0 " })).toBe(false);
    expect(backgroundAiChecks({ VITEST: "true" })).toBe(false);
    expect(backgroundAiChecks({ VITEST: "true", OMB_AI_CHECKS: "1" })).toBe(true);
    expect(backgroundAiChecks({ OMB_TEST_SEALED_PATH: "1" })).toBe(false);
    expect(backgroundAiChecks({ OMB_TEST_SEALED_PATH: "1", OMB_AI_CHECKS: "1" })).toBe(true);
  });
});
