import { WELCOME_VERSION } from "../../electron/onboarding-record.mjs";
import { freeFallback, rankAis, type AiTestState, type RankableAi } from "../../shared/ai-ranking";

export interface OnboardingStatus {
  completedAt: string;
  version: number;
  reelSeen: boolean;
  hintsSeen: string[];
  firstTurnAt?: string;
}

export { WELCOME_VERSION };

export const EMPTY_ONBOARDING: OnboardingStatus = {
  completedAt: "",
  version: 0,
  reelSeen: false,
  hintsSeen: [],
};

export interface WelcomeViewer {
  hosted: boolean;
  canSave: boolean;
}

export const LOCAL_VIEWER: WelcomeViewer = { hosted: false, canSave: true };

export function hostedMember(viewer: WelcomeViewer | null): boolean {
  return Boolean(viewer?.hosted && !viewer.canSave);
}

export function spotlightsQuiet(viewer: WelcomeViewer | null): boolean {
  return viewer === null || hostedMember(viewer);
}

export function welcomeViewer(session: unknown): WelcomeViewer {
  const record = session && typeof session === "object" ? (session as { hosted?: unknown; scopes?: unknown }) : {};
  return {
    hosted: record.hosted === true,
    canSave: Array.isArray(record.scopes) ? record.scopes.includes("admin") : true,
  };
}

export function welcomeDue(
  config: { onboarding?: OnboardingStatus } | null | undefined,
  options: { hosted?: boolean; canSave?: boolean } = {},
): boolean {
  if (options.canSave === false) return false;
  if (options.hosted && options.canSave !== true) return false;
  if (!config) return false;
  const record = config.onboarding ?? EMPTY_ONBOARDING;
  if (record.completedAt && record.version >= WELCOME_VERSION) return false;
  return true;
}

export function completionPatch(now: Date = new Date()): { onboarding: { completedAt: string; version: number } } {
  return { onboarding: { completedAt: now.toISOString(), version: WELCOME_VERSION } };
}

/** Kept by an install whose first run ended by meeting its Chief of Staff: its first conversation stays quiet (no
 * corner notices until a reply, no spotlights). */
export const MET_CHIEF_HINT = "met-chief-v1";

/** The first run's record: done, and marked as the one that met the Chief (MET_CHIEF_HINT), with `seen`: the notices
 * whose offer the welcome made itself. */
export function firstRunPatch(
  record: OnboardingStatus | undefined,
  now: Date = new Date(),
  seen: readonly string[] = [],
): { onboarding: { completedAt: string; version: number; hintsSeen?: string[] } } {
  const have = record?.hintsSeen ?? [];
  const added = [MET_CHIEF_HINT, ...seen].filter((id, at, all) => !have.includes(id) && all.indexOf(id) === at);
  return { onboarding: { ...completionPatch(now).onboarding, ...(added.length ? { hintsSeen: [...have, ...added] } : {}) } };
}

export function hintSeen(record: OnboardingStatus | undefined, id: string): boolean {
  return (record?.hintsSeen ?? []).includes(id);
}

export function hintSeenPatch(
  record: OnboardingStatus | undefined,
  id: string,
): { onboarding: { hintsSeen: string[] } } | null {
  if (hintSeen(record, id)) return null;
  return { onboarding: { hintsSeen: [...(record?.hintsSeen ?? []), id] } };
}


export type BeatId = "welcome" | "place" | "ai" | "bots" | "apps" | "done";

/** Every screen the first run can show, in the order it shows them. */
export const BEAT_ORDER: readonly BeatId[] = ["welcome", "place", "ai", "bots", "apps", "done"];

/** The first run's screens. `place`: the desktop app shows this computer's bots, so it may choose a server instead.
 * `welcomed`: the person met the app already, before pairing the server this page comes from. A hosted place's admin
 * only meets the app: their team's AI, bots and apps are already set up. */
export function beatsFor(options: { hosted?: boolean; place?: boolean; welcomed?: boolean }): BeatId[] {
  if (options.hosted) return ["welcome"];
  return BEAT_ORDER.filter((beat) => (beat !== "place" || options.place) && (beat !== "welcome" || !options.welcomed));
}

/** Where a reloaded first run opens: the saved screen while it is offered, else the first. */
export function resumeBeat(beats: readonly BeatId[], saved: BeatId | undefined): BeatId {
  return saved && beats.includes(saved) ? saved : beats[0] ?? "welcome";
}

const WELCOME_FINISHED_KEY = "omb.onboarding.welcomeFinished";
/** The first-run welcome ended in this app session (never a replay): the launch popups wait for a later launch rather than
 * following it. Kept for the window's session, so a reload counts as the same launch. */
// Where browser storage is blocked, this page's memory stands in for it.
let welcomeFinishedRemembered = false;
export function markWelcomeFinished(): void {
  try {
    sessionStorage.setItem(WELCOME_FINISHED_KEY, "1");
  } catch {
    welcomeFinishedRemembered = true;
  }
}
export function welcomeFinishedThisLaunch(): boolean {
  try {
    return sessionStorage.getItem(WELCOME_FINISHED_KEY) === "1";
  } catch {
    return welcomeFinishedRemembered;
  }
}

interface AiChoice {
  driverKind: string;
  access?: string;
  readOnly?: boolean;
  snapshot?: { freeFallback?: boolean };
}

/** The one way the welcome recommends to connect an AI, in the new-bot default's own order (shared/ai-ranking.ts: a Claude
 * account first, then a ChatGPT plan), and every other way. */
export function aiChoices<Instance extends AiChoice>(instances: readonly Instance[]): { recommended?: Instance; others: Instance[] } {
  const plan = (instance: Instance) => !instance.readOnly && instance.access !== "api" && instance.access !== "custom";
  const recommended = rankAis(instances.filter(plan))[0] ?? instances.find((instance) => !instance.readOnly);
  return { recommended, others: instances.filter((instance) => instance !== recommended) };
}

/** The AI the welcome's Connect an AI step stands on: the best ready AI (the same ranking) that isn't OpenCode's free
 * backup, passing over one whose test message got no answer. An AI not tested yet is `testing`; none ready is null. */
export function welcomeAi<Instance extends RankableAi>(
  instances: readonly Instance[],
  ready: (instance: Instance) => boolean,
  test: (instance: Instance) => AiTestState | undefined,
): { instance: Instance; state: AiTestState } | null {
  let silent: Instance | undefined;
  for (const instance of rankAis(instances.filter((candidate) => ready(candidate) && !freeFallback(candidate)))) {
    const state = test(instance) ?? "testing";
    if (state !== "failed") return { instance, state };
    silent ??= instance;
  }
  return silent ? { instance: silent, state: "failed" } : null;
}

/** It answered its test, or has no way to be tested and is trusted as before. */
export function aiWorks(found: { state: AiTestState } | null): boolean {
  return found?.state === "passed" || found?.state === "untestable";
}

interface SignInStep {
  snapshot: { state: string; authenticated?: boolean };
  authentication?: unknown;
  install?: { server?: unknown; managed?: unknown };
}

/** Whether the welcome's plain sign-in line fits this setup: a sign-in on the provider's own website, or a setup the app
 * does by itself before one. A step finished in Terminal keeps the setup's own instructions. */
export function plainSignIn(instance: SignInStep): boolean {
  return instance.snapshot.state === "available" && instance.snapshot.authenticated === false
    ? Boolean(instance.authentication)
    : Boolean(instance.install?.server || instance.install?.managed);
}

export function reducedMotion(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.reducedMotion === "true") return true;
  return globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
