// The recipe format and the contracts every driver keeps. A recipe stores what a step meant (a button's role and name, a
// window's title), never where it was on screen, so a repeat finds its targets again however the screen moved.

export type DriverKind = "cua" | "agent-browser";

/** What a tool call answered. `gate`: something in front of the computer refused the call (a person holds it); the step
 * was not tried. `text`: the call's text content, which a web snapshot needs. */
export type CallOutcome = { ok: true; structured: Record<string, unknown>; text?: string } | { ok: false; error: string; gate?: true };

/** Whatever reaches the real tools: an MCP client, an HTTP bridge, a test fake. */
export interface Caller {
  call(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallOutcome>;
}

export interface Patience {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

/** A call as a recorder keeps it: only what learning a step needs, never screenshots. */
export interface RecordedResult {
  isError: boolean;
  rpcError?: true;
  /** cua: the slimmed structured answer (apps, windows, elements without values). */
  structured?: Record<string, unknown>;
  /** agent-browser: the answer's text (a snapshot's lines). */
  text?: string;
}
export interface RecordedCall {
  tool: string;
  arguments: Record<string, unknown>;
  result: RecordedResult;
}

export type CuaTool = "click" | "double_click" | "right_click" | "type_text" | "set_value" | "press_key" | "scroll" | "launch_app" | "bring_to_front" | "hotkey";
export type WebTool = "open" | "click" | "dblclick" | "fill" | "press" | "check" | "uncheck" | "select" | "scroll" | "hover" | "back" | "forward" | "reload";

export interface AppIdentity { bundleId?: string; name?: string }
export interface ElementIdentity { role: string; label: string; path: string[] }

/** A desktop step (Cua driver): the app by bundle id or name, the window by title, the element by accessibility role,
 * label and the path of its labelled ancestors. `hint` is a last-resort point a replay uses only when asked to. */
export interface CuaStep {
  driver: "cua";
  tool: CuaTool;
  args: Record<string, unknown>;
  app?: AppIdentity;
  window?: { title: string };
  element?: ElementIdentity;
  hint?: { x: number; y: number };
}

/** A web element as an accessibility snapshot names it. `near`: the closest heading or landmark above it, kept only
 * when the role and name alone match more than one element. `url`: the page it was on, as origin and path. */
export interface WebTarget {
  role: string;
  name: string;
  near?: string;
  frame?: true;
  url?: string;
}

/** A browser step (agent-browser driver). */
export interface WebStep {
  driver: "agent-browser";
  tool: WebTool;
  args: Record<string, unknown>;
  target?: WebTarget;
}

export type Step = CuaStep | WebStep;

/** After the steps, `text` must be visible: on the page (agent-browser) or in the window (cua). */
export interface Check {
  kind: "text-visible";
  driver: DriverKind;
  text: string;
  app?: AppIdentity;
  window?: { title: string };
}

export const RECIPE_VERSION = 2;

export interface Recipe {
  version: typeof RECIPE_VERSION;
  id: string;
  /** What the recipe does, in the words it was recorded with. */
  name: string;
  /** `name` folded for matching: case, punctuation and filler words dropped. */
  key: string;
  /** The request word for word; the person's words a step types must come from it (strict policy). */
  request: string;
  /** 1 when recorded, one more each time a repair changes it. */
  revision: number;
  /** Placeholder names: a step's text or url may hold `{name}`, filled at each run. */
  inputs: string[];
  steps: Step[];
  checks: Check[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

export type Refusal =
  | "moment-words" | "incomplete-journal" | "denied" | "tool-error" | "unknown-tool" | "pixel-or-drag" | "extra-arguments"
  | "unknown-target" | "stale-element" | "unlabelled-element" | "ambiguous-element" | "typed-text-not-in-request" | "url-not-in-request"
  | "no-steps" | "too-many-steps" | "typing-appends" | "toggle-element" | "key-without-window" | "partial-tree" | "final-action"
  | "secret-field" | "unreadable-field" | "missing-input";

/** What a recipe may hold. strict: the person's own words only (typed text and links must be in the request, no
 * moment words such as "this" or "latest"); standard: what the recording typed is typed again. Final actions (send,
 * delete, pay and their like) and secret fields are refused under both. */
export type Policy = "strict" | "standard";

export interface LearnContext {
  request: string;
  policy: Policy;
}

export type Learned<S extends Step = Step> = { ok: true; steps: Array<{ at: number; step: S }> } | { ok: false; reason: Refusal };

/** Where a step acts, found on the live screen: the arguments the real tool takes. `missing`: not there yet, worth
 * another look in a moment. */
export type Resolved = { ok: true; tool: string; args: Record<string, unknown> } | (Extract<CallOutcome, { ok: false }> & { missing?: true });

/** One automation surface: how its calls become steps, how a step is found again and done, how a check is read. */
export interface Driver<S extends Step = Step> {
  readonly kind: S["driver"];
  /** Whether a recorded call belongs to this driver. */
  owns(tool: string): boolean;
  /** Steps from this driver's calls, in order; `at` is each step's index in `calls`. */
  learn(calls: readonly RecordedCall[], context: LearnContext): Learned<S>;
  /** Why a loaded step must not run (a final action, a secret field, a malformed target), or null. */
  refusal(step: S, policy: Policy): Refusal | null;
  /** The person's words a step carries: text it types and links it opens. */
  words(step: S): { typed: unknown[]; urls: unknown[] };
  /** A short label for the step's target, from screen text. */
  label(step: S): string;
  resolve(step: S, signal: AbortSignal): Promise<Resolved>;
  perform(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallOutcome>;
  /** Whether the check's text is visible now. */
  sees(check: Check, signal: AbortSignal): Promise<{ ok: true; seen: boolean } | Extract<CallOutcome, { ok: false }>>;
}
