import { textEditJournal as textEditCalls } from "../../packages/agent-steps/src/testing/cua-fixtures.ts";
import type { RecordedCall, RequestJournal } from "../saved-steps/journal.ts";

export { completeWindowState, recordedWindowState, windowState } from "../../packages/agent-steps/src/testing/cua-fixtures.ts";

/** The package's TextEdit recording as one request's journal, every call in generation g1. */
export function textEditJournal(overrides: { calls?: RecordedCall[]; complete?: boolean; tainted?: boolean } = {}): RequestJournal {
  const calls = overrides.calls ?? textEditCalls().calls.map((call) => ({ ...call, generation: "g1" }));
  return { calls, complete: overrides.complete ?? true, tainted: overrides.tainted ?? false };
}
