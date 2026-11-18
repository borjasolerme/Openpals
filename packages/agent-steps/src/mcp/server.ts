// An MCP server that sits in front of a driver's own MCP server (agent-browser, cua-driver): it passes every tool through
// and adds steps_start, steps_stop, steps_list, steps_run and steps_repair. While a recording is on, every passed-through
// call is kept; steps_run repeats a recipe with no model in the loop.
import { requestKey } from "../key.ts";
import { reviseRecipe, parseRecipe, stepLabel } from "../recipe.ts";
import { createRecorder, recordedResult, type Recorder } from "../recorder.ts";
import { replay } from "../replay.ts";
import type { FileStore } from "../store.ts";
import type { Driver, Patience, Recipe } from "../types.ts";
import { callOutcome, type McpTool } from "./client.ts";

export interface Upstream {
  tools(): Promise<McpTool[]>;
  callRaw(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

type RpcId = string | number | null;
type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

const inputsSchema = { type: "object", additionalProperties: { type: "string" }, description: "Values for the recipe's {placeholders}, by name." };
export const STEPS_TOOLS: McpTool[] = [
  {
    name: "steps_start",
    description: "Start recording. Do the task with the other tools; every call is kept until steps_stop. Name it by what it does. Give inputs for values that change between runs (a recipient, a date); they become {placeholders}.",
    inputSchema: { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string", minLength: 1 }, inputs: inputsSchema } },
  },
  {
    name: "steps_stop",
    description: "Stop recording and save the recipe. checks: text that must be visible when the steps are done. discard: drop the recording.",
    inputSchema: { type: "object", additionalProperties: false, properties: { checks: { type: "array", items: { type: "string", minLength: 1 } }, discard: { type: "boolean" } } },
  },
  { name: "steps_list", description: "List saved recipes: name, steps, inputs and revision.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  {
    name: "steps_run",
    description: "Repeat a saved recipe without a model: each step is found again on screen by its role and name. If a step fails, the result says which; do that part yourself, or call steps_repair to record the rest again.",
    inputSchema: { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string", minLength: 1 }, inputs: inputsSchema } },
  },
  {
    name: "steps_repair",
    description: "Record a recipe again from step `at` (1-based): the steps before it stay, then do the rest with the other tools and call steps_stop. The recipe keeps its name and its revision goes up by one.",
    inputSchema: { type: "object", required: ["name", "at"], additionalProperties: false, properties: { name: { type: "string", minLength: 1 }, at: { type: "integer", minimum: 1 }, inputs: inputsSchema } },
  },
];
const STEPS_NAMES = new Set(STEPS_TOOLS.map((tool) => tool.name));

const say = (text: string, structured?: Record<string, unknown>, isError = false): ToolResult => ({
  content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}), ...(isError ? { isError: true } : {}),
});
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const stringMap = (value: unknown): Record<string, string> | undefined =>
  isRecord(value) && Object.values(value).every((item) => typeof item === "string") ? (value as Record<string, string>) : undefined;
const summary = (recipe: Recipe) => ({ name: recipe.name, id: recipe.id, revision: recipe.revision, steps: recipe.steps.length, inputs: recipe.inputs, checks: recipe.checks.map((check) => check.text) });

export function createStepsServer(deps: { driver: Driver; upstream: Upstream; store: FileStore; now?: () => number; id?: () => string; patience?: Patience }) {
  const now = deps.now ?? Date.now;
  let recording: { recorder: Recorder; name: string; inputs?: Record<string, string>; repair?: { recipe: Recipe; at: number } } | null = null;
  const begin = (name: string, inputs?: Record<string, string>, repair?: { recipe: Recipe; at: number }) => {
    recording = { recorder: createRecorder({ driver: deps.driver, policy: "standard", now, ...(deps.id ? { id: deps.id } : {}) }), name, ...(inputs ? { inputs } : {}), ...(repair ? { repair } : {}) };
  };

  async function stepsCall(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (name === "steps_list") {
      const recipes = deps.store.list().map(summary);
      return say(recipes.length ? recipes.map((recipe) => `${recipe.name} (${recipe.steps} steps, revision ${recipe.revision})`).join("\n") : "No saved recipes.", { recipes });
    }
    if (name === "steps_start") {
      if (typeof args.name !== "string" || !args.name.trim()) return say("Give the recipe a name.", undefined, true);
      if (recording) return say(`Already recording "${recording.name}". Call steps_stop first.`, undefined, true);
      begin(args.name.trim(), stringMap(args.inputs));
      return say(`Recording "${args.name.trim()}". Do the task, then call steps_stop.`);
    }
    if (name === "steps_stop") {
      const current = recording;
      if (!current) return say("Nothing is being recorded.", undefined, true);
      recording = null;
      if (args.discard === true) return say("Recording dropped.");
      const checks = Array.isArray(args.checks) ? args.checks.filter((check): check is string => typeof check === "string" && check.trim() !== "") : [];
      const built = current.recorder.stop({ name: current.repair?.recipe.name ?? current.name, ...(current.inputs ? { inputs: current.inputs } : {}), checks });
      if (!built.ok) return say(`Not saved: ${built.reason}.`, { saved: false, reason: built.reason }, true);
      let recipe = built.recipe;
      if (current.repair) {
        const { recipe: old, at } = current.repair;
        const steps = [...old.steps.slice(0, at - 1), ...recipe.steps];
        recipe = reviseRecipe({ ...old, inputs: [...new Set([...old.inputs, ...recipe.inputs])] }, { steps, checks: checks.length ? recipe.checks : old.checks }, now());
        if (!parseRecipe(recipe, "standard")) return say("Not saved: the repaired recipe is not valid.", { saved: false }, true);
      }
      deps.store.save(recipe);
      return say(`Saved "${recipe.name}": ${recipe.steps.length} steps, revision ${recipe.revision}.`, { saved: true, recipe: summary(recipe) });
    }
    const recipe = typeof args.name === "string" ? deps.store.find(requestKey(args.name)) : undefined;
    if (!recipe) return say(`No saved recipe named "${String(args.name ?? "")}". steps_list shows them.`, undefined, true);
    if (name === "steps_repair") {
      const at = typeof args.at === "number" && Number.isInteger(args.at) ? args.at : 0;
      if (at < 1 || at > recipe.steps.length + 1) return say(`at must be a step number from 1 to ${recipe.steps.length + 1}.`, undefined, true);
      if (recording) return say(`Already recording "${recording.name}". Call steps_stop first.`, undefined, true);
      begin(recipe.name, stringMap(args.inputs), { recipe, at });
      return say(`Recording "${recipe.name}" again from step ${at}. Do the rest of the task, then call steps_stop.`);
    }
    const outcome = await replay(recipe, { driver: deps.driver, inputs: stringMap(args.inputs) ?? {}, policy: "standard", ...(signal ? { signal } : {}), ...(deps.patience ? { patience: deps.patience } : {}), now });
    if (outcome.kind === "done") {
      deps.store.touch(recipe.id);
      return say(`Done: ran ${recipe.steps.length} steps of "${recipe.name}".`, { outcome: "done", steps: recipe.steps.length });
    }
    if (outcome.kind === "failed") {
      const where = outcome.check ? `the check ${outcome.label}` : `step ${outcome.index + 1} of ${outcome.total} (${outcome.tool} ${outcome.label})`;
      return say(`Stopped at ${where}: ${outcome.error}. Steps 1-${outcome.done} are done. Finish the task yourself, or call steps_repair with at=${outcome.index + 1} to record the rest.`,
        { outcome: "failed", at: outcome.index + 1, done: outcome.done, total: outcome.total, step: outcome.check ? null : stepLabel(recipe.steps[outcome.index]!), error: outcome.error }, true);
    }
    return say(`Stopped (${outcome.kind}).`, { outcome: outcome.kind }, true);
  }

  async function handle(frame: unknown): Promise<unknown> {
    if (!isRecord(frame) || typeof frame.method !== "string") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } };
    if (!Object.hasOwn(frame, "id")) return undefined;
    const id = (frame.id ?? null) as RpcId;
    const answer = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    const fail = (message: string, code = -32603) => ({ jsonrpc: "2.0", id, error: { code, message } });
    try {
      if (frame.method === "initialize") return answer({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "agent-steps", version: "0.1.0" } });
      if (frame.method === "ping") return answer({});
      if (frame.method === "tools/list") return answer({ tools: [...(await deps.upstream.tools()).filter((tool) => !STEPS_NAMES.has(tool.name)), ...STEPS_TOOLS] });
      if (frame.method !== "tools/call") return fail("Method not found.", -32601);
      const params = isRecord(frame.params) ? frame.params : {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = isRecord(params.arguments) ? params.arguments : {};
      if (STEPS_NAMES.has(name)) return answer(await stepsCall(name, args));
      const result = await deps.upstream.callRaw(name, args);
      recording?.recorder.record({ tool: name, arguments: args, result: recordedResult(callOutcome(result), deps.driver.kind) });
      return answer(result);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  return { handle, recording: () => recording?.name ?? null };
}

/** Serves `handle` on stdin and stdout, one JSON-RPC message per line. */
export function serveStdio(handle: (frame: unknown) => Promise<unknown>, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): void {
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } })}\n`);
        continue;
      }
      void handle(frame).then((reply) => { if (reply !== undefined) output.write(`${JSON.stringify(reply)}\n`); });
    }
  });
}
