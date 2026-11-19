import { computerPersonAwayText } from "../computer-wait.ts";
import { CONTROL_BUSY, CONTROL_HANDED_BACK, CONTROL_REFUSAL_PLAIN, CONTROL_TURN_ENDED, CONTROL_UNCONFIRMED, CONTROL_WAITED } from "../control-client.ts";
import { ChatMcpClient } from "../drivers/chat-mcp-tools.ts";
import { harnessMcpRequest } from "../harness-mcp-request.ts";
import { harnessMcpTokenEnv } from "../harness-mcp-token.ts";
import type { Caller, CallOutcome } from "agent-steps";

export type ComputerCaller = Caller & { close(): Promise<void> };

export const STEP_TIMEOUT_MS = 60_000;
const ERROR_CHARS = 300;
const INVALID: CallOutcome = { ok: false, error: "the computer returned an invalid result" };

export type LocalComputerSpec = { command: string; args: string[]; env: Record<string, string> };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const GATE_REFUSALS: ReadonlySet<string> = new Set([CONTROL_REFUSAL_PLAIN, CONTROL_HANDED_BACK, CONTROL_WAITED, CONTROL_BUSY, CONTROL_UNCONFIRMED, CONTROL_TURN_ENDED]);
const PERSON_AWAY = computerPersonAwayText(60_000).replace(/ for over [\s\S]*$/u, " for over ");
const gateRefusal = (text: string) => GATE_REFUSALS.has(text) || text.startsWith(PERSON_AWAY);

function errorOutcome(content: unknown[]): CallOutcome {
  const text = content.flatMap((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : [])).join(" ").trim();
  if (!text) return { ok: false, error: "the tool reported an error" };
  return { ok: false, error: text.slice(0, ERROR_CHARS), ...(gateRefusal(text) ? { gate: true as const } : {}) };
}

function refusalText(refusal: unknown): string {
  if (isRecord(refusal)) {
    for (const key of ["message", "code"]) {
      const text = refusal[key];
      if (typeof text === "string" && text.trim()) return text.slice(0, ERROR_CHARS);
    }
  }
  return "the computer refused the call";
}

export function callOutcome(result: unknown): CallOutcome {
  if (!isRecord(result) || !Array.isArray(result.content)) return INVALID;
  const { isError, structuredContent } = result;
  if (isError !== undefined && typeof isError !== "boolean") return INVALID;
  if (structuredContent !== undefined && structuredContent !== null && !isRecord(structuredContent)) return INVALID;
  const structured = isRecord(structuredContent) ? structuredContent : {};
  if (isError) return errorOutcome(result.content);
  if (structured.refusal !== undefined && structured.refusal !== null) return { ok: false, error: refusalText(structured.refusal) };
  const text = result.content.flatMap((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : [])).join("\n");
  return { ok: true, structured, ...(text ? { text } : {}) };
}

/** This computer: the turn's own gated proxy, journaled like the AI's calls, so a repair can learn from the whole run. */
export async function openComputerCaller(computer: LocalComputerSpec, signal: AbortSignal): Promise<ComputerCaller> {
  // Security invariant: a replay drives only the turn's gated proxy, so the control gate and the person's consent still apply.
  if (!computer.env.OMB_CONTROL_URL || !computer.env.OMB_CONTROL_TOKEN) throw new Error("this computer is not behind its control gate");
  const client = new ChatMcpClient({ command: computer.command, args: computer.args, env: computer.env }, true);
  try {
    await client.tools(signal);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
  return {
    async call(tool, args, callSignal) {
      try {
        return callOutcome(await client.call("tools/call", { name: tool, arguments: args }, callSignal, STEP_TIMEOUT_MS));
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "the computer could not be reached" };
      }
    },
    close: () => client.close(),
  };
}

const stopped = (signal: AbortSignal) => new Promise<CallOutcome>((resolve) => {
  if (signal.aborted) resolve({ ok: false, error: "stopped" });
  signal.addEventListener("abort", () => resolve({ ok: false, error: "stopped" }), { once: true });
});

/** A lent computer's screen or a bot's browser: the turn's harness endpoint with the turn's own capability, so the gate,
 * the person's hold and the journal apply to a replay exactly as to the AI. */
export function openHarnessCaller(spec: { env: Record<string, string> }, kind: "computer" | "browser"): ComputerCaller {
  const connection = { url: spec.env.OMB_HARNESS_URL ?? "", token: spec.env[harnessMcpTokenEnv(kind)] ?? "", kind };
  if (!connection.url || !connection.token) throw new Error(`this turn has no ${kind} connection`);
  let id = 0;
  return {
    async call(tool, args, signal) {
      const answered = harnessMcpRequest({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: tool, arguments: args } }, connection).then((frame) => {
        const reply = frame as { result?: unknown; error?: { message?: unknown } } | undefined;
        if (reply?.error) return { ok: false as const, error: typeof reply.error.message === "string" ? reply.error.message.slice(0, ERROR_CHARS) : "the call failed" };
        return callOutcome(reply?.result);
      });
      return Promise.race([answered, stopped(signal)]);
    },
    close: async () => {},
  };
}
