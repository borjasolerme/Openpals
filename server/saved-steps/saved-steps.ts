import { randomUUID } from "node:crypto";
import { botFolder } from "../bot-folder.ts";
import type { AppConfig } from "../config.ts";
import type { RuntimeEvent } from "../contracts.ts";
import { createComputerJournalRoutes } from "../routes/computer-journal.ts";
import { createSavedStepsRoutes } from "../routes/saved-steps.ts";
import type { RouteHandler } from "../routes/table.ts";
import type { Message } from "../store.ts";
import { agentBrowserDriver, cuaDriver, learnRecipe, recordedResult, reviseRecipe, type DriverKind, type Recipe, type Refusal } from "../../packages/agent-steps/src/index.ts";
import { callOutcome, openComputerCaller, openHarnessCaller, type ComputerCaller } from "./computer-client.ts";
import { SavedStepsDispatch, type DispatchDeps, type EngineSlots, type TurnPlaces } from "./dispatch.ts";
import { ComputerJournal, hostScope, turnScope, type JournalCapability, type RequestJournal } from "./journal.ts";
import { BotRecipes } from "./recipes.ts";
import { otherToolsHarmless, personTextRequest } from "./requests.ts";

export { COMPUTER_JOURNAL_PATH } from "./journal-tap.ts";

export interface SavedStepsDeps {
  enabled(): boolean;
  bot(id: string): unknown;
  publish(event: RuntimeEvent): void;
  engines: EngineSlots;
  stopped(threadId: string): boolean;
  generation(threadId: string): string | undefined;
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): void;
  withholdHandoff: DispatchDeps["withholdHandoff"];
  contextChanged: DispatchDeps["contextChanged"];
  folder?: (botId: string) => string;
  now?: () => number;
  platform?: NodeJS.Platform;
}

export interface SettledRequest {
  botId: string;
  threadId: string;
  request: Message;
  reply: Message;
  after: readonly Message[];
  generations: ReadonlySet<string>;
  automated: boolean;
}

/** `personLine`: the request began with the person's own line here, not work a peer handed on with the person's origin. */
export interface RequestOwner { automation?: unknown; origin?: { kind: string }; personLine?: boolean }

export const personRequest = (owner: RequestOwner): boolean => owner.automation === undefined && owner.origin?.kind === "user";

export interface SavedSteps {
  journal: ComputerJournal;
  recipes: BotRecipes;
  dispatch: SavedStepsDispatch;
  gateChecked(capability: JournalCapability): void;
  journals(owner: RequestOwner | undefined): boolean;
  routes: RouteHandler;
  journalRoutes(internal: { capability: JournalCapability; readBody(): Promise<unknown> }): RouteHandler;
  /** Runs one MCP request a lent computer or a bot's browser answers here, and journals it when it is a tool call of a
   * request that learns. */
  journalCall<T>(capability: JournalCapability, owner: RequestOwner | undefined, kind: DriverKind, body: unknown, run: () => Promise<T>): Promise<T>;
  requestSettled(settled: SettledRequest): void;
  requestEnded(threadId: string, generations: ReadonlySet<string>): void;
  observe(event: RuntimeEvent): void;
}

export function savedStepsEnabled(cfg: Pick<AppConfig, "features">): boolean {
  return cfg.features?.savedSteps !== false;
}

/** Saving every journaled call of one request, in the order made, as a recipe with the person's own words only. */
export function learnFromJournal(request: string, journal: RequestJournal, id: string, now: number): { ok: true; recipe: Recipe } | { ok: false; reason: Refusal | "several-turns" } {
  if (!journal.complete) return { ok: false, reason: "incomplete-journal" };
  if (journal.tainted) return { ok: false, reason: "denied" };
  if (new Set(journal.calls.map((call) => call.generation)).size > 1) return { ok: false, reason: "several-turns" };
  const calls = journal.calls.map(({ generation: _generation, ...call }) => call);
  return learnRecipe({ calls, drivers: [cuaDriver(), agentBrowserDriver()], request, policy: "strict", id, now });
}

/** A replay reaches this computer through the turn's gated proxy; a lent computer and the browser through the turn's
 * harness endpoint, with the same capability the AI holds. */
async function openTurnCaller(kind: DriverKind, places: TurnPlaces, signal: AbortSignal): Promise<ComputerCaller> {
  if (kind === "agent-browser") {
    if (!places.browser) throw new Error("this turn has no browser");
    return openHarnessCaller(places.browser, "browser");
  }
  if (!places.computer) throw new Error("this turn has no computer");
  return places.computer.scope === "lent-computer" ? openHarnessCaller(places.computer, "computer") : openComputerCaller(places.computer, signal);
}

const toolCall = (body: unknown): { name: string; arguments: Record<string, unknown> } | null => {
  const frame = body as { method?: unknown; params?: { name?: unknown; arguments?: unknown } } | null;
  if (frame?.method !== "tools/call" || typeof frame.params?.name !== "string") return null;
  const args = frame.params.arguments;
  return { name: frame.params.name, arguments: typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {} };
};

const keepsFromSaving = (event: RuntimeEvent): boolean =>
  (event.type === "request.resolved" && event.behavior !== "allow") || (event.type === "turn.completed" && (event.denials?.length ?? 0) > 0);

export function createSavedSteps(deps: SavedStepsDeps): SavedSteps {
  const platform = deps.platform ?? process.platform;
  const enabled = () => deps.enabled();
  const journal = new ComputerJournal();
  const now = deps.now ?? Date.now;
  const recipes = new BotRecipes({ folder: deps.folder ?? botFolder, ...(deps.now ? { now: deps.now } : {}) });
  const taint = (threadId: string): boolean => {
    const generation = deps.generation(threadId);
    if (generation === undefined) return false;
    journal.taint({ threadId, generation });
    return true;
  };
  const dispatch = new SavedStepsDispatch({
    recipes,
    enabled,
    publish: deps.publish,
    engines: deps.engines,
    stopped: deps.stopped,
    openCaller: openTurnCaller,
    taint,
    markable: (threadId) => deps.generation(threadId) !== undefined,
    hostDesktop: platform === "darwin",
    withholdHandoff: deps.withholdHandoff,
    contextChanged: deps.contextChanged,
  });

  const markOrSave = ({ botId, threadId, request, reply, after, automated }: SettledRequest, taken: RequestJournal | null): void => {
    const repair = dispatch.takeRepair(threadId);
    const replayed = reply.turnId === undefined ? undefined : dispatch.replayed(threadId, reply.turnId);
    if (replayed !== undefined) {
      recipes.touch(botId, replayed);
      if (request.quickModel !== undefined) deps.patchMessage(threadId, request.id, { quickModel: undefined });
      deps.patchMessage(threadId, reply.id, { savedSteps: { recipeId: replayed, replayed: true } });
      return;
    }
    // A recipe the AI took over from is replaced by what its run learned, or forgotten if that run learns nothing.
    // A person holding the computer is no fault of the recipe's, so it then stays as it was.
    const learned = !enabled() || automated || !taken?.calls.length || !personTextRequest(request) || after.some((line) => line.role === "user") || !otherToolsHarmless(after)
      ? null : learnFromJournal(request.text ?? "", taken, repair?.recipe.id ?? randomUUID(), now());
    if (!learned?.ok || !dispatch.wouldReplay(threadId, learned.recipe)) {
      if (repair && !repair.gate) recipes.forget(botId, repair.recipe.id);
      return;
    }
    const recipe = repair ? reviseRecipe(repair.recipe, { steps: learned.recipe.steps }, now()) : learned.recipe;
    recipes.save(botId, recipe);
    deps.patchMessage(threadId, reply.id, { savedSteps: { recipeId: recipe.id, ...(repair ? { repaired: true as const } : { learned: true as const }) } });
  };

  return {
    journal,
    recipes,
    dispatch,
    routes: createSavedStepsRoutes({ bot: deps.bot, forget: (botId, id) => recipes.forget(botId, id) }),
    gateChecked(capability) {
      const scope = hostScope(capability);
      if (scope) journal.gateChecked(scope);
      else if (capability.kind === "computer") journal.taint({ threadId: capability.threadId, generation: capability.generation });
    },
    journals: (owner) => owner?.personLine === true && personRequest(owner) && enabled(),
    journalRoutes: (internal) => createComputerJournalRoutes({ ...internal, enabled, record: (scope, entry) => journal.record(scope, entry) }),
    async journalCall(capability, owner, kind, body, run) {
      const call = toolCall(body);
      if (!call || !(owner?.personLine === true && personRequest(owner) && enabled())) return run();
      // Counted before the call and recorded after it: a call that throws leaves the request's journal incomplete.
      const scope = turnScope(capability);
      journal.gateChecked(scope);
      const result = await run();
      journal.record(scope, { tool: call.name, arguments: call.arguments, result: recordedResult(callOutcome(result), kind) });
      return result;
    },
    requestSettled(settled) {
      const taken = journal.take(settled.threadId, settled.generations);
      const unmarked = dispatch.takeUnmarked(settled.threadId);
      try {
        markOrSave(settled, unmarked ? null : taken);
      } catch (error) {
        console.warn(`saved steps for ${settled.botId} on ${settled.threadId} not saved: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    requestEnded(threadId, generations) {
      journal.take(threadId, generations);
      dispatch.takeUnmarked(threadId);
      dispatch.takeRepair(threadId);
    },
    observe(event) {
      if (keepsFromSaving(event)) taint(event.threadId);
    },
  };
}
