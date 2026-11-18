// The browser driver: agent-browser's tools (agent_browser_snapshot, agent_browser_click, ...), reached through whatever
// Caller the host gives it. Each targeted step reads a fresh snapshot and acts on the one element with its role and name.
import type { Caller, CallOutcome, Driver, Resolved, WebStep } from "../types.ts";
import { WEB_PREFIX, learnWeb, webLabel, webOwns, webRefusal, webWords } from "./rules.ts";
import { matching, pageOf, readSnapshot } from "./snapshot.ts";

export interface AgentBrowserDriverOptions {
  /** The tools' name prefix, `agent_browser_` by default. */
  prefix?: string;
}

const textOf = (outcome: Extract<CallOutcome, { ok: true }>): string => outcome.text ?? "";

export function agentBrowserDriver(caller?: Caller, options: AgentBrowserDriverOptions = {}): Driver<WebStep> {
  const prefix = options.prefix ?? WEB_PREFIX;
  const live = (): Caller => {
    if (!caller) throw new Error("this agent-browser driver was made without a caller, so it can only learn");
    return caller;
  };
  const snapshot = (signal: AbortSignal) => live().call(`${prefix}snapshot`, {}, signal);
  return {
    kind: "agent-browser",
    owns: prefix === WEB_PREFIX ? webOwns : (tool) => tool.startsWith(prefix),
    learn: (calls, context) => learnWeb(prefix === WEB_PREFIX ? calls : calls.map((call) => ({ ...call, tool: WEB_PREFIX + call.tool.slice(prefix.length) })), context),
    refusal: webRefusal,
    words: webWords,
    label: webLabel,
    async resolve(step, signal): Promise<Resolved> {
      const tool = `${prefix}${step.tool}`;
      const { target } = step;
      if (!target) return { ok: true, tool, args: step.args };
      if (target.url) {
        const where = await live().call(`${prefix}get_url`, {}, signal);
        const here = where.ok ? pageOf(textOf(where).trim()) : undefined;
        if (here !== undefined && here !== target.url) return { ok: false, error: `the page is ${here}, not ${target.url}`, missing: true };
      }
      const seen = await snapshot(signal);
      if (!seen.ok) return seen;
      const found = matching(readSnapshot(textOf(seen)), target);
      const named = `"${target.name}" (${target.role})`;
      if (found.length === 0) return { ok: false, error: `no ${named} on the page`, missing: true };
      if (found.length > 1) return { ok: false, error: `more than one ${named} on the page` };
      return { ok: true, tool, args: { ...step.args, selector: `@${found[0]!.ref}` } };
    },
    perform: (tool, args, signal) => live().call(tool, args, signal),
    async sees(check, signal) {
      const seen = await snapshot(signal);
      return seen.ok ? { ok: true, seen: textOf(seen).includes(check.text) } : seen;
    },
  };
}
