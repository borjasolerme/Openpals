// Test before trusting: a new bot's default is an AI that answered one tiny test message whenever any AI did.
//
// Nothing waits for a test. The default is chosen by ranking at once (shared/ai-ranking.ts); the person's own AIs are
// tested in the background in the order the default takes them, one at a time, stopping at the first that answers. One
// miss demotes nothing: that AI is tried again in two minutes, and only two misses in a row count as "didn't answer"
// (selectDefaultModelSelection's `answered`), when the default moves to the best AI that did; a failed AI is tried once
// more ten minutes later. Results are kept for a day per instance and sign-in, so a start or a settings save doesn't send
// another test message. A saved default (Settings, `openmausbot setup`, the New Bot defaults) or a hosted workspace's is
// never tested here and never moves.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { aiSignInKey, rankAis, type AiTestState } from "../shared/ai-ranking.ts";
import { writeFileAtomic } from "./atomic.ts";
import type { ModelSelection, ProviderSnapshot } from "./contracts.ts";
import { readyToRun, type DefaultSelectionContext, type SelectableInstance } from "./default-model-selection.ts";
import { checkEngine, type CheckableEngine, type EngineCheck } from "./engine-check.ts";

export interface TestedAiDeps {
  /** The live engine a test message goes through. */
  engine(instanceId: string): CheckableEngine | null;
  /** The defaults the person saved: the default model and the New Bot defaults' model. */
  saved(): ReadonlyArray<ModelSelection | undefined>;
  /** A hosted workspace's models: its default is not the app's to choose either. */
  hosted?(): boolean;
  context: DefaultSelectionContext;
  /** A test finished or a retry is due: the server reads the engines and the default again, which settles here. */
  changed(): Promise<unknown> | void;
  /** The engine's own settings (configIdentity): a changed key is a new sign-in. */
  identity?(instanceId: string): string;
  /** Where the results are kept; none keeps them in memory. */
  file?: string;
  /** Whether tests start on their own (backgroundAiChecks); a check asked for always runs. */
  background?: boolean;
  timeoutMs?: number;
  now?(): number;
  after?(ms: number, run: () => void): { cancel(): void };
}

/** A status read that drops the account now and then looks like a new sign-in each time: a new sign-in is tested in the
 * background at most this often per AI, so it never sends a stream of test messages. A check asked for is not held back. */
const BACKGROUND_SPACING_MS = 5 * 60_000;
/** After the first miss, then after the second; then once an hour, so a used-up limit or an outage doesn't hold an AI back
 * for a day. */
const RETRY_AFTER_MS = [2 * 60_000, 10 * 60_000] as const;
const SLOW_RETRY_MS = 60 * 60_000;
/** Two misses in a row: the AI didn't answer. */
const MISSES_TO_FAIL = 2;
const RESULT_TTL_MS = 24 * 60 * 60_000;

/** On unless OMB_AI_CHECKS=0. Under vitest or a sealed test fixture (env-path.ts) only with OMB_AI_CHECKS=1, as
 * local-inject's probe: a fake engine's turn log then holds only the turns a test sends. */
export function backgroundAiChecks(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.OMB_AI_CHECKS?.trim();
  if (flag === "0") return false;
  return (env.VITEST !== "true" && env.OMB_TEST_SEALED_PATH !== "1") || flag === "1";
}

/** What makes an engine sign in: its driver, settings and environment (keys among them), never its name or icon. Kept as a
 * short hash next to config.json, which holds the same keys in full. */
export function configIdentity(entry: { driver?: unknown; config?: unknown; environment?: unknown } | undefined): string {
  return createHash("sha256").update(JSON.stringify([entry?.driver ?? null, entry?.config ?? null, entry?.environment ?? null]))
    .digest("hex").slice(0, 16);
}

type Subject = { instanceId: string; snapshot: ProviderSnapshot };
type Result = { key: string; state: "passed" | "failed" | "untestable"; misses: number; at: number; error?: string; retryAt?: number };
type Saved = { results: Record<string, Result> };

const empty = (selection: ModelSelection | undefined) => !selection?.instanceId && !selection?.model;
const hasModel = (instance: SelectableInstance) =>
  Boolean(instance.models.default.trim() || instance.models.options.some((option) => option.id.trim()));

function load(file: string | undefined, now: number): Saved {
  if (!file) return { results: {} };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Saved>;
    const results: Record<string, Result> = {};
    for (const [id, result] of Object.entries(raw.results && typeof raw.results === "object" ? raw.results : {})) {
      if (result && typeof result.key === "string" && ["passed", "failed", "untestable"].includes(result.state)
        && typeof result.at === "number" && now - result.at < RESULT_TTL_MS) results[id] = result;
    }
    return { results };
  } catch {
    return { results: {} };
  }
}

export function createTestedAi(deps: TestedAiDeps) {
  const background = deps.background ?? backgroundAiChecks();
  const now = deps.now ?? Date.now;
  const after = deps.after ?? ((ms: number, run: () => void) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  });
  const saved = load(deps.file, now());
  const running = new Map<string, { key: string; run: Promise<EngineCheck> }>();
  const startedAt = new Map<string, number>();
  const retries = new Map<string, { cancel(): void }>();
  let pending = 0;
  let issued = 0;
  let settledRead = 0;
  let lastSelection: ModelSelection | null = null;
  let lastInstances: readonly SelectableInstance[] = [];

  const fixed = () => deps.hosted?.() === true || deps.saved().some((selection) => !empty(selection));
  const warn = (what: string, error: unknown) => console.warn(`[engines] ${what}: ${error instanceof Error ? error.message : String(error)}`);
  const keyOf = (subject: Subject) => `${aiSignInKey(subject.snapshot)}|${deps.identity?.(subject.instanceId) ?? ""}`;

  const save = () => {
    if (!deps.file) return;
    try {
      mkdirSync(dirname(deps.file), { recursive: true });
      writeFileAtomic(deps.file, JSON.stringify(saved), { mode: 0o600 });
    } catch (error) {
      warn("could not keep the AI test results", error);
    }
  };

  /** This AI's result as it is signed in now, if it is less than a day old. */
  const resultOf = (subject: Subject): Result | undefined => {
    const result = saved.results[subject.instanceId];
    return result && result.key === keyOf(subject) && now() - result.at < RESULT_TTL_MS ? result : undefined;
  };
  const state = (subject: Subject): AiTestState | undefined =>
    running.get(subject.instanceId)?.key === keyOf(subject) ? "testing" : resultOf(subject)?.state;
  /** For selectDefaultModelSelection: true it answered, false it missed twice in a row, undefined not known yet. A test
   * under way changes nothing until it ends, so the default never bounces back to an AI while it is tried again. */
  const answered = (subject: Subject): boolean | undefined => {
    const result = resultOf(subject);
    return result?.state === "passed" ? true : result?.state === "failed" && result.misses >= MISSES_TO_FAIL ? false : undefined;
  };

  const notify = () => {
    pending++;
    void Promise.resolve().then(deps.changed)
      .catch((error: unknown) => warn("reading the new-bot default again after a test message", error))
      .finally(() => { pending--; });
  };
  const arm = (instanceId: string, at: number) => {
    retries.get(instanceId)?.cancel();
    retries.set(instanceId, after(Math.max(0, at - now()), () => {
      retries.delete(instanceId);
      notify();
    }));
  };

  const record = (instanceId: string, key: string, check: EngineCheck) => {
    const previous = saved.results[instanceId]?.key === key ? saved.results[instanceId] : undefined;
    if (check.ok === false) {
      const misses = (previous?.state === "failed" ? previous.misses : 0) + 1;
      const delay = RETRY_AFTER_MS[misses - 1] ?? SLOW_RETRY_MS;
      saved.results[instanceId] = { key, state: "failed", misses, at: now(), error: check.error, retryAt: now() + delay };
      if (background) arm(instanceId, now() + delay);
    } else {
      retries.get(instanceId)?.cancel();
      saved.results[instanceId] = { key, state: check.ok ? "passed" : "untestable", misses: 0, at: now() };
    }
    save();
  };

  /** A fresh test, or the one already under way for this sign-in. Every result reads the default again. */
  const test = (subject: Subject): Promise<EngineCheck> => {
    const engine = deps.engine(subject.instanceId);
    if (!engine) return Promise.resolve({ ok: null });
    const key = keyOf(subject);
    const current = running.get(subject.instanceId);
    if (current?.key === key) return current.run;
    const run = checkEngine(engine, deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs });
    const entry = { key, run };
    running.set(subject.instanceId, entry);
    pending++;
    void run.then(async (check) => {
      if (running.get(subject.instanceId) === entry) running.delete(subject.instanceId);
      record(subject.instanceId, key, check);
      try {
        await deps.changed();
      } catch (error) {
        warn("reading the new-bot default again after a test message", error);
      } finally {
        pending--;
      }
    });
    return run;
  };

  /** The person's own AIs, in the default's order, one at a time; an organization's models and the trial credit are theirs
   * to look after. One miss waits for its retry; two hand over to the next AI. */
  const sweep = () => {
    if (!background || fixed()) return;
    const own = lastInstances.filter((instance) => readyToRun(instance, deps.context) && hasModel(instance)
      && deps.context.company?.(instance.instanceId) !== true);
    for (const instance of rankAis(own)) {
      if (running.has(instance.instanceId)) return;
      const result = resultOf(instance);
      if (!result) {
        if (now() - (startedAt.get(instance.instanceId) ?? -Infinity) >= BACKGROUND_SPACING_MS) {
          startedAt.set(instance.instanceId, now());
          void test(instance);
        }
        return;
      }
      if (result.state !== "failed") return;
      if (result.retryAt !== undefined && result.retryAt <= now()) {
        void test(instance);
        return;
      }
      if (result.misses < MISSES_TO_FAIL) return;
    }
  };

  if (background) {
    for (const [instanceId, result] of Object.entries(saved.results)) if (result.retryAt !== undefined && result.retryAt > now()) arm(instanceId, result.retryAt);
  }

  return {
    /** Taken before the engines are read: only the latest read may settle anything (settle's `read`). */
    read(): number {
      return ++issued;
    },
    /** The default the server just chose for new bots: tests start from it. A read older than one already settled changes
     * nothing and gets the newer default back. */
    settle(selection: ModelSelection, instances: readonly SelectableInstance[], read = ++issued): ModelSelection {
      if (read < settledRead) return lastSelection ?? selection;
      settledRead = read;
      lastSelection = selection;
      lastInstances = instances;
      sweep();
      return selection;
    },
    answered,
    state,
    /** The instance info's fields the welcome reads. */
    info(instance: Subject): { aiTest?: AiTestState; aiTestError?: string } {
      const result = state(instance);
      const error = result === "failed" ? resultOf(instance)?.error : undefined;
      return result ? { aiTest: result, ...(error ? { aiTestError: error } : {}) } : {};
    },
    /** POST /api/instances/:id/check: live, as setup's check always was, sharing only a test already under way. */
    async check(instance: CheckableEngine & { snapshot(): Promise<ProviderSnapshot> }): Promise<EngineCheck> {
      return test({ instanceId: instance.instanceId, snapshot: await instance.snapshot() });
    },
    /** A test or what follows from its result is still under way. */
    testing(): boolean {
      return pending > 0;
    },
  };
}

export type TestedAi = ReturnType<typeof createTestedAi>;
