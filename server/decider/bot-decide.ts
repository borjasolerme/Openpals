// The shape a bot's own question (the decide tool) must have before it is sent.
import { jevRequestBody } from "./jev.ts";
import type { DeciderQuestion } from "./types.ts";

export const KEY_CHECK_STATE = { purpose: "Openpals is checking that a decision-model key works." };
export const KEY_CHECK_QUESTION = "Is this a connection check?";

/** Measured in UTF-8 bytes. */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_STATE_BYTES = 24_000;
const LIMITS = { questions: 8, options: 20, levels: 10, id: /^[A-Za-z0-9_.-]{1,64}$/, instructions: 1_000, meaning: 300 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const shortText = (value: unknown, max: number): boolean => typeof value === "string" && value.trim().length > 0 && value.length <= max;

function questionFits(id: string, question: DeciderQuestion): boolean {
  if (!LIMITS.id.test(id) || !shortText(question.instructions, LIMITS.instructions)) return false;
  if (question.type === "choice") {
    const entries = Object.entries(question.options ?? {});
    return entries.length >= 2 && entries.length <= LIMITS.options && entries.every(([key, meaning]) => LIMITS.id.test(key) && shortText(meaning, LIMITS.meaning));
  }
  if (question.type === "score") return Array.isArray(question.levels) && question.levels.length >= 2 && question.levels.length <= LIMITS.levels && question.levels.every((level) => shortText(level, LIMITS.meaning));
  if (question.type !== "yesno") return false;
  const criteria = question.criteria;
  return criteria === undefined || (isRecord(criteria) && Object.keys(criteria).every((key) => key === "yes" || key === "no") &&
    Object.values(criteria).every((text) => text === undefined || shortText(text, LIMITS.meaning)));
}

export function botDecideAccepts(state: unknown, questions: Record<string, DeciderQuestion>): boolean {
  try {
    const ids = Object.keys(questions);
    if (ids.length < 1 || ids.length > LIMITS.questions || !ids.every((id) => questionFits(id, questions[id]!))) return false;
    if (typeof state === "string" ? state.trim().length === 0 : !isRecord(state) && !Array.isArray(state)) return false;
    return Buffer.byteLength(JSON.stringify(state)) <= MAX_STATE_BYTES &&
      Buffer.byteLength(JSON.stringify(jevRequestBody(state, questions))) <= MAX_BODY_BYTES;
  } catch {
    return false;
  }
}
