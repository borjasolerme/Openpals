// Who a usage row was spent for. Work a teammate did for a delegating turn names the person whose turn started the job,
// followed down the trace's parent links.
import type { UsageRow } from "./usage-ledger.ts";

const REMEMBERED_TURNS = 5_000;

export interface UsageAttributionDeps {
  /** What started the conversation's current turn: a parent still running has no row yet. */
  threadTrigger?(threadId: string): UsageRow["trigger"] | undefined;
}

export function createUsageAttribution(deps: UsageAttributionDeps) {
  const turnPerson = new Map<string, string>();
  const remember = (turnId: string | undefined, email: string | undefined) => {
    if (!turnId || !email) return;
    turnPerson.delete(turnId);
    turnPerson.set(turnId, email);
    if (turnPerson.size > REMEMBERED_TURNS) turnPerson.delete(turnPerson.keys().next().value!);
  };
  return <Row extends Pick<UsageRow, "botId" | "trigger" | "turnId" | "parent">>(row: Row): Row => {
    let trigger = row.trigger;
    if (trigger.kind !== "user" && trigger.kind !== "routine" && !trigger.email && row.parent) {
      // A teammate can finish before the turn that delegated to it is booked.
      const parentTrigger = deps.threadTrigger?.(row.parent.threadId);
      const email = turnPerson.get(row.parent.turnId) ?? (parentTrigger ? personOf(parentTrigger) : undefined);
      if (email) trigger = { ...trigger, email };
    }
    remember(row.turnId, personOf(trigger));
    return { ...row, trigger };
  };
}

/** The person a row was spent for, if any. */
export function personOf(trigger: UsageRow["trigger"]): string | undefined {
  return trigger.email;
}
