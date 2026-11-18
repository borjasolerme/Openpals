import { allowsTool } from "../../shared/tool-scope.ts";
import { newId, type ProviderAdapter, type ProviderInstance, type RuntimeEvent, type SendTurnInput, type TurnStartResult } from "../contracts.ts";
import { createChatToolApproval } from "../drivers/chat-tool-approval.ts";
import { retriedTurnEvent, type RetriedTurn } from "../quick-model-fallback.ts";
import type { Message } from "../store.ts";
import { agentBrowserDriver, cuaDriver, recipeFitsRequest, requestKey, stepLabel, type Driver, type DriverKind, type Recipe } from "../../packages/agent-steps/src/index.ts";
import type { ComputerCaller, LocalComputerSpec } from "./computer-client.ts";
import type { BotRecipes } from "./recipes.ts";
import { personTextRequest } from "./requests.ts";
import { declinedReply, engineToolName, fallbackNote, replayedReply, runSteps, type ReplayOutcome, type ReplayTurn } from "./run.ts";

export interface EngineSlots { get(threadId: string): ProviderInstance | undefined; set(threadId: string, engine: ProviderInstance): void }
export interface ReplayRequest {
  botId: string;
  message: Message;
  /** The person's words this turn sends: several queued lines arrive as one turn, under the last line's message. */
  turnText: string;
  /** The person picked this computer (or the computer lent to the bot) as the bot's place, so its screen calls never stop
   * to ask them first. */
  placePicked: boolean;
}
/** Where a turn's saved steps run: the turn's own computer and browser connections. */
export interface TurnPlaces { computer?: LocalComputerSpec & { scope?: "local-computer" | "lent-computer" }; browser?: { env: Record<string, string> } }
/** A recipe a failed replay handed to the AI: the AI's run, journaled with the replay's, becomes its next revision. */
export interface Repair { recipe: Recipe; gate: boolean }
export interface DispatchDeps {
  recipes: Pick<BotRecipes, "find" | "forget">;
  enabled(): boolean;
  publish(event: RuntimeEvent): void;
  engines: EngineSlots;
  stopped(threadId: string): boolean;
  /** A caller for one driver of the turn: the computer's gated proxy or harness endpoint, or the bot's browser. */
  openCaller(kind: DriverKind, places: TurnPlaces, signal: AbortSignal): Promise<ComputerCaller>;
  /** Keeps the request from saving steps: a turn that sends more than the request's own line did work its words do not
   * name, and a replay that was stopped or declined left a run no one finished. False when the request cannot be marked. */
  taint(threadId: string): boolean;
  /** Whether the thread's request can be marked; a replay runs only then, so one stopped halfway never saves. */
  markable(threadId: string): boolean;
  /** The engine never sees a replayed turn: what the turn would have handed it stays unreceived; the call returned hands it on if the AI takes over. */
  withholdHandoff(threadId: string): (turnId: string) => void;
  /** A replay answered without the engine, so the engine's session must learn that line and its reply from the conversation. */
  contextChanged(botId: string, threadId: string): void;
}

type Start = (input: SendTurnInput) => Promise<TurnStartResult>;
type Approval = ReturnType<typeof createChatToolApproval>;
type RunOutcome = ReplayOutcome | { kind: "error"; message: string };
type Failed = Extract<ReplayOutcome, { kind: "failed" }>;

interface Run extends RetriedTurn {
  turnId: string;
  threadId: string;
  botId: string;
  recipe: Recipe;
  engine: ProviderInstance;
  controller: AbortController;
  phase: "replay" | "fallback";
  finished: Promise<void>;
  handOn(turnId: string): void;
}

const STOPPED = { kind: "stopped" } as const satisfies ReplayOutcome;
const LOOKUPS = ["list_apps", "list_windows", "get_window_state"] as const;
const WEB_LOOKUPS = ["agent_browser_snapshot", "agent_browser_get_url"] as const;
const COMPUTER_SERVER = "computer";
const BROWSER_SERVER = "browser";
const REMEMBERED_REPLIES = 256;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class SavedStepsDispatch {
  private readonly deps: DispatchDeps;
  private readonly runs = new Map<string, Run>();
  private readonly answered = new Map<string, { turnId: string; recipeId: string }>();
  private readonly unmarked = new Set<string>();
  private readonly replayable = new Map<string, { toolScope: unknown; drivers: ReadonlySet<DriverKind> }>();
  private readonly repairs = new Map<string, Repair>();

  constructor(deps: DispatchDeps) {
    this.deps = deps;
  }

  sendTurn(engine: ProviderInstance, request: ReplayRequest | null, input: SendTurnInput, start: Start): Promise<TurnStartResult> {
    this.runs.delete(input.threadId);
    this.replayable.delete(input.threadId);
    if (request && this.replayHolds(request, input)) {
      this.replayable.set(input.threadId, { toolScope: input.toolScope, drivers: turnDrivers(request, input) });
      while (this.replayable.size > REMEMBERED_REPLIES) this.replayable.delete(this.replayable.keys().next().value!);
    }
    if (request && request.turnText !== request.message.text) {
      if (!this.deps.taint(input.threadId)) this.unmarked.add(input.threadId);
      return start(input);
    }
    const recipe = request ? this.recipeFor(request, input) : undefined;
    if (!request || !recipe || !this.deps.markable(input.threadId)) return start(input);
    const places: TurnPlaces = { ...(input.integrations?.localComputer ? { computer: input.integrations.localComputer } : {}), ...(input.integrations?.browser ? { browser: input.integrations.browser } : {}) };
    const { threadId } = input;
    const run: Run = {
      turnId: newId(), threadId, botId: request.botId, recipe, engine, controller: new AbortController(), phase: "replay", finished: Promise.resolve(),
      handOn: this.deps.withholdHandoff(threadId),
    };
    const asked = new Set<string>();
    // Only this computer's own approvals carry its scope, so host-only rules never reach a lent computer or a browser.
    const hostScope = places.computer?.scope === "local-computer" ? { approvalScope: "local-computer" as const } : {};
    const approval = createChatToolApproval({
      signal: run.controller.signal,
      open: (ask) => {
        asked.add(ask.id);
        this.emit(run, {
          type: "request.opened", requestType: "permission", requestId: ask.id, tool: ask.tool, summary: ask.summary,
          ...hostScope, allowSession: false,
        });
      },
      resolved: (ask, allowed, source) => this.emit(run, {
        type: "request.resolved", requestId: ask.id, behavior: allowed ? "allow" : "deny", source, ...hostScope,
      }),
      openQuestion: () => {},
      resolvedQuestion: () => {},
    });
    this.runs.set(threadId, run);
    this.deps.engines.set(threadId, this.standIn(run, approval, asked));
    // After dispatch binds this turn id to the request, so no event of the replay comes before its turn is known.
    run.finished = new Promise((resolve) => {
      setImmediate(() => {
        this.replay(run, places, input, start, approval).then(resolve, (error: unknown) => {
          console.warn(`saved steps on ${threadId} ended early: ${errorText(error)}`);
          run.controller.abort();
          if (this.runs.get(threadId) === run && run.phase === "replay") this.end(run, { kind: "error", message: errorText(error) });
          resolve();
        });
      });
    });
    return Promise.resolve({ turnId: run.turnId });
  }

  /** The bus's gate for adapter events: true when this took the AI's event for a replay it handed over. */
  take(event: RuntimeEvent): boolean {
    const run = this.runs.get(event.threadId);
    if (!run || run.phase !== "fallback") return false;
    const kept = retriedTurnEvent(run, event);
    if (kept === null) return false;
    if (kept === "dropped") return true;
    if (kept.type === "turn.completed") this.forgetRun(run);
    this.deps.publish(kept);
    return true;
  }

  /** True when a turn of the thread's ending request sent more than its line and could not be marked; it must not save. Taking it forgets it. */
  takeUnmarked(threadId: string): boolean {
    return this.unmarked.delete(threadId);
  }

  /** Whether the thread's latest turn met every condition for replaying this recipe, so "next time no AI" would hold. */
  wouldReplay(threadId: string, recipe: Recipe): boolean {
    const turn = this.replayable.get(threadId);
    return turn !== undefined && driversThere(recipe, turn.drivers) && toolsAllowed(recipe, turn.toolScope);
  }

  /** The recipe a failed replay of the thread's ending request handed to the AI, if one did. Taking it forgets it. */
  takeRepair(threadId: string): Repair | undefined {
    const repair = this.repairs.get(threadId);
    this.repairs.delete(threadId);
    return repair;
  }

  /** True for the events of a replay still answering without the AI, its turn.completed included. */
  answering(event: RuntimeEvent): boolean {
    const run = this.runs.get(event.threadId);
    return run !== undefined && run.phase === "replay" && event.turnId === run.turnId;
  }

  /** The recipe that answered this turn with no AI. */
  replayed(threadId: string, turnId: string): string | undefined {
    const answer = this.answered.get(threadId);
    return answer?.turnId === turnId ? answer.recipeId : undefined;
  }

  private replayHolds(request: ReplayRequest, input: SendTurnInput): boolean {
    return this.deps.enabled() && input.approvalMode === "full" && turnDrivers(request, input).size > 0
      && personTextRequest(request.message) && request.turnText === request.message.text;
  }

  private recipeFor(request: ReplayRequest, input: SendTurnInput): Recipe | undefined {
    if (!this.replayHolds(request, input)) return undefined;
    const text = request.turnText;
    const recipe = this.deps.recipes.find(request.botId, requestKey(text));
    return recipe && recipeFitsRequest(recipe, text) && driversThere(recipe, turnDrivers(request, input)) && toolsAllowed(recipe, input.toolScope) ? recipe : undefined;
  }

  private standIn(run: Run, approval: Approval, asked: ReadonlySet<string>): ProviderInstance {
    const { adapter } = run.engine;
    const standIn: ProviderAdapter = {
      get provider() { return adapter.provider; },
      get capabilities() { return adapter.capabilities; },
      get cacheKeepWarm() { return adapter.cacheKeepWarm; },
      sendTurn: (input) => adapter.sendTurn(input),
      async interruptTurn(threadId, turnId) {
        if (run.phase === "fallback") return adapter.interruptTurn(threadId, turnId);
        run.controller.abort();
        await run.finished;
      },
      respondToRequest: async (threadId, requestId, decision) => (asked.has(requestId)
        ? approval.answer(requestId, decision.behavior, decision.message)
        : adapter.respondToRequest(threadId, requestId, decision)),
      steer: async () => "refused",
      hasSession: (threadId) => adapter.hasSession(threadId),
      stopAll: () => adapter.stopAll(),
      onEvent: (listener) => adapter.onEvent(listener),
    };
    return Object.create(run.engine, { adapter: { value: standIn } }) as ProviderInstance;
  }

  private async replay(run: Run, places: TurnPlaces, input: SendTurnInput, start: Start, approval: Approval): Promise<void> {
    this.emit(run, { type: "turn.started" });
    const outcome = await this.runSteps(run, places, approval);
    approval.close();
    if (outcome.kind === "failed") return this.fallBack(run, outcome, input, start);
    if (outcome.kind === "error") this.forget(run);
    this.end(run, outcome);
  }

  private async runSteps(run: Run, places: TurnPlaces, approval: Approval): Promise<RunOutcome> {
    const { signal } = run.controller;
    if (signal.aborted) return STOPPED;
    const callers: ComputerCaller[] = [];
    const drivers: Driver[] = [];
    try {
      for (const kind of new Set(run.recipe.steps.map((step) => step.driver))) {
        const caller = await this.deps.openCaller(kind, places, signal);
        callers.push(caller);
        drivers.push(kind === "cua" ? cuaDriver(caller) : agentBrowserDriver(caller));
      }
    } catch (error) {
      await Promise.all(callers.map((caller) => caller.close().catch(() => {})));
      if (signal.aborted) return STOPPED;
      const [first] = run.recipe.steps;
      return { kind: "failed", done: 0, total: run.recipe.steps.length, tool: first!.tool, label: stepLabel(first!), error: errorText(error) };
    }
    try {
      return await runSteps(run.recipe, this.turn(run), { drivers, approval, publish: this.deps.publish, signal });
    } catch (error) {
      return signal.aborted ? STOPPED : { kind: "error", message: errorText(error) };
    } finally {
      await Promise.all(callers.map((caller) => caller.close().catch(() => {})));
    }
  }

  /** The AI finishes the request; the recipe stays until its run settles, and then becomes what that run learned. */
  private async fallBack(run: Run, failed: Failed, input: SendTurnInput, start: Start): Promise<void> {
    this.repairs.set(run.threadId, { recipe: run.recipe, gate: failed.gate === true });
    while (this.repairs.size > REMEMBERED_REPLIES) this.repairs.delete(this.repairs.keys().next().value!);
    if (run.controller.signal.aborted || this.deps.stopped(run.threadId)) {
      this.repairs.delete(run.threadId);
      return this.end(run, STOPPED);
    }
    this.deps.engines.set(run.threadId, run.engine);
    const note = fallbackNote(failed);
    const noted = (text: string) => `${text}\n\n${note}`;
    const handed = { ...input, text: noted(input.text), ...(input.recoveryText !== undefined ? { recoveryText: noted(input.recoveryText) } : {}) };
    run.phase = "fallback";
    run.handOn(run.turnId);
    let sent: TurnStartResult;
    try {
      sent = await start(handed);
    } catch (error) {
      if (this.runs.get(run.threadId) === run) this.end(run, { kind: "error", message: errorText(error) });
      return;
    }
    run.retryTurnId ??= sent.turnId;
    if (this.deps.stopped(run.threadId)) void run.engine.adapter.interruptTurn(run.threadId).catch(() => {});
  }

  private end(run: Run, outcome: Exclude<RunOutcome, Failed>): void {
    try {
      if (run.phase === "replay") this.markContextChanged(run);
      if (outcome.kind === "done") {
        this.answered.delete(run.threadId);
        this.answered.set(run.threadId, { turnId: run.turnId, recipeId: run.recipe.id });
        while (this.answered.size > REMEMBERED_REPLIES) this.answered.delete(this.answered.keys().next().value!);
        this.reply(run, replayedReply(run.recipe));
        this.emit(run, { type: "turn.completed", ok: true, stopReason: "end_turn" });
      } else if (outcome.kind === "declined") {
        this.deps.taint(run.threadId);
        this.reply(run, declinedReply(outcome));
        const step = run.recipe.steps[outcome.index];
        this.emit(run, { type: "turn.completed", ok: true, stopReason: "end_turn", denials: [step ? engineToolName(step) : outcome.tool] });
      } else if (outcome.kind === "stopped") {
        this.deps.taint(run.threadId);
        this.emit(run, { type: "turn.completed", ok: false, stopReason: "interrupted" });
      } else {
        this.deps.taint(run.threadId);
        this.emit(run, { type: "runtime.error", message: outcome.message });
        this.emit(run, { type: "turn.completed", ok: false, stopReason: outcome.message });
      }
    } finally {
      this.forgetRun(run);
    }
  }

  private markContextChanged(run: Run): void {
    try {
      this.deps.contextChanged(run.botId, run.threadId);
    } catch (error) {
      console.warn(`saved steps on ${run.threadId}: the conversation was not marked for the engine to read again: ${errorText(error)}`);
    }
  }

  private forget(run: Run): void {
    try {
      this.deps.recipes.forget(run.botId, run.recipe.id);
    } catch (error) {
      console.warn(`saved steps ${run.recipe.id} for ${run.botId} not forgotten: ${errorText(error)}`);
    }
  }

  private forgetRun(run: Run): void {
    if (this.runs.get(run.threadId) === run) this.runs.delete(run.threadId);
  }

  private reply(run: Run, text: string): void {
    this.emit(run, { type: "item.completed", itemType: "assistant_text", itemId: newId(), text });
  }

  private turn(run: Run): ReplayTurn {
    return { threadId: run.threadId, turnId: run.turnId, provider: run.engine.driverKind, providerInstanceId: run.engine.instanceId };
  }

  private emit(run: Run, event: DistributiveOmit<RuntimeEvent, "eventId" | "createdAt" | "threadId" | "provider">): void {
    this.deps.publish({ eventId: newId(), createdAt: new Date().toISOString(), ...this.turn(run), ...event } as RuntimeEvent);
  }
}

/** The drivers a turn can replay through: this computer or the lent one when the person picked it, and the bot's browser. */
function turnDrivers(request: ReplayRequest, input: SendTurnInput): ReadonlySet<DriverKind> {
  const drivers = new Set<DriverKind>();
  const scope = input.integrations?.localComputer?.scope;
  if (request.placePicked && (scope === "local-computer" || scope === "lent-computer")) drivers.add("cua");
  if (input.integrations?.browser) drivers.add("agent-browser");
  return drivers;
}

const driversThere = (recipe: Recipe, drivers: ReadonlySet<DriverKind>): boolean => recipe.steps.every((step) => drivers.has(step.driver));

function toolsAllowed(recipe: Recipe, toolScope: unknown): boolean {
  const kinds = new Set(recipe.steps.map((step) => step.driver));
  const lookups = [...(kinds.has("cua") ? LOOKUPS.map((name) => ({ server: COMPUTER_SERVER, name })) : []), ...(kinds.has("agent-browser") ? WEB_LOOKUPS.map((name) => ({ server: BROWSER_SERVER, name })) : [])];
  const acts = recipe.steps.map((step) => (step.driver === "cua" ? { server: COMPUTER_SERVER, name: step.tool } : { server: BROWSER_SERVER, name: `agent_browser_${step.tool}` }));
  return [...lookups, ...acts].every(({ server, name }) => allowsTool(toolScope, { kind: "mcp", server, name }));
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
