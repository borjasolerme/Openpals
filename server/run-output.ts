// A routine run stores a clipped copy of its last reply; a closing NEEDS INPUT question must survive the cut.

const CLOSING_QUESTION = /^\s*needs input:/i;

/** A run's reply cut to max characters for its stored output. A reply that ends on a NEEDS INPUT question (with at most
 * a default: line after it) keeps that question at the end, whole when it fits and else cut on its own line, so a long
 * reply still reads as waiting on the person. */
export function clipRunOutput(text: string, max: number): string {
  if (text.length <= max) return text;
  const lines = text.split(/\r?\n/);
  const at = lines.findLastIndex((line) => CLOSING_QUESTION.test(line));
  const after = at < 0 ? [] : lines.slice(at + 1).filter((line) => line.trim());
  const closing = at >= 0 && (after.length === 0 || (after.length === 1 && /^default:/i.test(after[0]!.trim())));
  if (!closing) return text.slice(0, max);
  const tail = lines.slice(at).join("\n").trim();
  if (tail.length > max) {
    const question = lines[at]!.trim();
    // A bare NEEDS INPUT: line asks through its default: line, so that line is kept (cut) with it.
    // Blank lines between them and the default: line's own indent say nothing, so they go first; otherwise they could push it out.
    if (!question.replace(CLOSING_QUESTION, "").trim()) return `${[question, ...after.map((line) => line.trim())].join("\n").slice(0, max - 1)}…`;
    return question.length <= max ? question : `${question.slice(0, max - 1)}…`;
  }
  const room = max - tail.length - 3;
  return room > 0 ? `${text.slice(0, room).trimEnd()}\n…\n${tail}` : tail;
}

/** A run's reply, kept: a later item that says nothing does not erase the report the run already delivered. */
export function keptRunOutput(delivered: string | undefined, text: string, max: number): string | undefined {
  return clipRunOutput(text, max) || delivered;
}
