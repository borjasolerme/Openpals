// A recipe from a recording, the checks every loaded recipe passes again, and the change a repair makes.
import { z } from "zod";
import { cuaLabel, cuaRefusal, cuaWords, learnCua } from "./cua/rules.ts";
import { exactRequest, hasMomentWords, inRequest, requestKey } from "./key.ts";
import { RECIPE_VERSION, type Check, type Driver, type DriverKind, type Learned, type Policy, type Recipe, type RecordedCall, type Refusal, type Step } from "./types.ts";
import { learnWeb, webLabel, webRefusal, webWords } from "./web/rules.ts";

export const MAX_STEPS = 40;

/** What each kind of step needs no live computer for: learning, checking and naming. */
interface Rules<S extends Step> {
  learn: Driver<S>["learn"];
  refusal: Driver<S>["refusal"];
  words: Driver<S>["words"];
  label: Driver<S>["label"];
}
const RULES: { [K in DriverKind]: Rules<Extract<Step, { driver: K }>> } = {
  cua: { learn: learnCua, refusal: cuaRefusal, words: cuaWords, label: cuaLabel },
  "agent-browser": { learn: learnWeb, refusal: webRefusal, words: webWords, label: webLabel },
};
const rulesFor = <S extends Step>(step: S) => RULES[step.driver] as unknown as Rules<S>;

export const stepRefusal = (step: Step, policy: Policy): Refusal | null => rulesFor(step).refusal(step, policy);
export const stepWords = (step: Step) => rulesFor(step).words(step);
export const stepLabel = (step: Step): string => rulesFor(step).label(step);

const CONTROL_CHARACTERS = /\p{Cc}/u;
const PLACEHOLDER = /\{([A-Za-z_][\w-]{0,40})\}/gu;

function wordsOutsideRequest(steps: readonly Step[], request: string): "typed-text-not-in-request" | "url-not-in-request" | null {
  for (const step of steps) {
    const { typed, urls } = stepWords(step);
    if (!typed.every((value) => typeof value === "string" && value === value.trim() && !CONTROL_CHARACTERS.test(value) && inRequest(value, request))) return "typed-text-not-in-request";
    if (!urls.every((value) => typeof value === "string" && inRequest(value, request))) return "url-not-in-request";
  }
  return null;
}

/** Steps that type the person's words or open their links: only the request they came from, word for word, may repeat them. */
export function holdsPersonWords(steps: readonly Step[]): boolean {
  return steps.some((step) => {
    const { typed, urls } = stepWords(step);
    return typed.length > 0 || urls.length > 0;
  });
}

/** Strict policy: whether this request may run this recipe. */
export function recipeFitsRequest(recipe: Pick<Recipe, "steps" | "request">, request: string): boolean {
  const exact = exactRequest(request);
  if (holdsPersonWords(recipe.steps) && (recipe.request === "" || exact !== recipe.request)) return false;
  return wordsOutsideRequest(recipe.steps, exact) === null;
}

function placeholders(value: unknown, found: Set<string>): void {
  if (typeof value === "string") for (const match of value.matchAll(PLACEHOLDER)) found.add(match[1]!);
  else if (Array.isArray(value)) for (const item of value) placeholders(item, found);
}

/** The placeholder names a recipe's steps use. */
export function usedInputs(steps: readonly Step[]): Set<string> {
  const found = new Set<string>();
  for (const step of steps) for (const value of Object.values(step.args)) placeholders(value, found);
  return found;
}

function fill(value: unknown, inputs: Readonly<Record<string, string>>): unknown {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER, (_whole, name: string) => {
      const given = inputs[name];
      if (given === undefined) throw Object.assign(new Error(`no value for {${name}}`), { refusal: "missing-input" as const });
      return given;
    });
  }
  return Array.isArray(value) ? value.map((item) => fill(item, inputs)) : value;
}

/** The step with every `{name}` in its arguments replaced by its input. Throws when an input is missing. */
export function fillInputs<S extends Step>(step: S, inputs: Readonly<Record<string, string>>): S {
  return { ...step, args: Object.fromEntries(Object.entries(step.args).map(([key, value]) => [key, fill(value, inputs)])) };
}

/** Text a recording typed that is one of the inputs' values becomes that input's placeholder. */
function parameterize(step: Step, inputs: Readonly<Record<string, string>>): Step {
  const entries = Object.entries(inputs).filter(([, value]) => value !== "").sort((a, b) => b[1].length - a[1].length);
  if (!entries.length) return step;
  const swap = (value: unknown): unknown => {
    if (typeof value === "string") return entries.reduce((text, [name, given]) => text.split(given).join(`{${name}}`), value);
    return Array.isArray(value) ? value.map(swap) : value;
  };
  return { ...step, args: Object.fromEntries(Object.entries(step.args).map(([key, value]) => [key, swap(value)])) };
}

export interface LearnInput {
  /** The calls in the order they were made; each must belong to one of `drivers`. */
  calls: readonly RecordedCall[];
  drivers: ReadonlyArray<Pick<Driver, "kind" | "owns" | "learn">>;
  /** What the recipe does: the person's request, or a name the recorder gave it. */
  request: string;
  policy: Policy;
  id: string;
  now: number;
  /** Values the recording typed that change from run to run, by placeholder name. */
  inputs?: Readonly<Record<string, string>>;
  checks?: Check[];
}

/** A recipe from a recording, or why it cannot be one. */
export function learnRecipe(input: LearnInput): { ok: true; recipe: Recipe } | { ok: false; reason: Refusal } {
  const { calls, drivers, request, policy } = input;
  const refuse = (reason: Refusal) => ({ ok: false as const, reason });
  if (policy === "strict" && hasMomentWords(request)) return refuse("moment-words");
  const byDriver = new Map<(typeof drivers)[number], number[]>();
  for (const [index, call] of calls.entries()) {
    const driver = drivers.find((candidate) => candidate.owns(call.tool));
    if (!driver) return refuse("unknown-tool");
    byDriver.set(driver, [...(byDriver.get(driver) ?? []), index]);
  }
  const placed: Array<{ at: number; step: Step }> = [];
  for (const [driver, indexes] of byDriver) {
    const learned: Learned = driver.learn(indexes.map((index) => calls[index]!), { request, policy });
    if (!learned.ok) return learned;
    for (const { at, step } of learned.steps) placed.push({ at: indexes[at]!, step });
  }
  placed.sort((a, b) => a.at - b.at);
  const steps = placed.map(({ step }) => parameterize(step, input.inputs ?? {}));
  if (steps.length === 0) return refuse("no-steps");
  if (steps.length > MAX_STEPS) return refuse("too-many-steps");
  const exact = exactRequest(request);
  if (policy === "strict") {
    const outside = wordsOutsideRequest(steps, exact);
    if (outside) return refuse(outside);
  }
  const used = usedInputs(steps);
  return {
    ok: true,
    recipe: {
      version: RECIPE_VERSION, id: input.id, name: exact, key: requestKey(request), request: exact, revision: 1,
      inputs: Object.keys(input.inputs ?? {}).filter((name) => used.has(name)), steps, checks: input.checks ?? [],
      createdAt: input.now, updatedAt: input.now, lastUsedAt: input.now,
    },
  };
}

/** The recipe a repair leaves: same id and request, the new steps or checks, one revision more. */
export function reviseRecipe(recipe: Recipe, change: { steps?: Step[]; checks?: Check[] }, now: number): Recipe {
  return { ...recipe, ...change, revision: recipe.revision + 1, updatedAt: now, lastUsedAt: now };
}

const identity = z.object({ bundleId: z.string().optional(), name: z.string().optional() }).strict();
const windowTitle = z.object({ title: z.string() }).strict();
const args = z.record(z.string(), z.unknown());
const cuaStep = z.object({
  driver: z.literal("cua"),
  tool: z.enum(["click", "double_click", "right_click", "set_value", "press_key", "scroll", "launch_app", "bring_to_front", "hotkey"]),
  args,
  app: identity.optional(),
  window: windowTitle.optional(),
  element: z.object({ role: z.string(), label: z.string(), path: z.array(z.string()) }).strict().optional(),
  hint: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
}).strict();
const webStep = z.object({
  driver: z.literal("agent-browser"),
  tool: z.enum(["open", "click", "dblclick", "fill", "press", "check", "uncheck", "select", "scroll", "hover", "back", "forward", "reload"]),
  args,
  target: z.object({ role: z.string(), name: z.string(), near: z.string().optional(), frame: z.literal(true).optional(), url: z.string().optional() }).strict().optional(),
}).strict();
const check = z.object({
  kind: z.literal("text-visible"), driver: z.enum(["cua", "agent-browser"]), text: z.string().min(1), app: identity.optional(), window: windowTitle.optional(),
}).strict();

export const recipeSchema = z.object({
  version: z.literal(RECIPE_VERSION),
  id: z.string().min(1),
  name: z.string(),
  key: z.string().min(1),
  request: z.string(),
  revision: z.number().int().min(1),
  inputs: z.array(z.string().regex(/^[A-Za-z_][\w-]{0,40}$/u)),
  steps: z.array(z.discriminatedUnion("driver", [cuaStep, webStep])).min(1).max(MAX_STEPS),
  checks: z.array(check).max(MAX_STEPS),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  lastUsedAt: z.number().finite(),
}).strict();

/** Why a recipe read back from anywhere must not run, or null. */
export function recipeRefusal(recipe: Recipe, policy: Policy): Refusal | "malformed" | null {
  if (recipe.key !== requestKey(recipe.name)) return "malformed";
  for (const step of recipe.steps) {
    const refusal = stepRefusal(step, policy);
    if (refusal) return refusal;
  }
  for (const name of usedInputs(recipe.steps)) if (!recipe.inputs.includes(name)) return "missing-input";
  if (policy === "strict") {
    if (recipe.inputs.length) return "missing-input";
    if (holdsPersonWords(recipe.steps) && (recipe.request !== exactRequest(recipe.request) || !recipeFitsRequest(recipe, recipe.request))) return "typed-text-not-in-request";
  }
  return null;
}

/** A recipe parsed and checked, or null. */
export function parseRecipe(raw: unknown, policy: Policy): Recipe | null {
  const parsed = recipeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const recipe = parsed.data as Recipe;
  return recipeRefusal(recipe, policy) === null ? recipe : null;
}
