// Who may use the owner's own things (their paired phones, server/phones/owner.ts): only a turn the harness can prove acts
// for the owner (a conversation they started from their own admin-scoped device, a room member answering their own line
// there, or a routine they wrote or started by hand), in a conversation they opened that has never held anybody else's
// words, since a resumed session carries everything said in it. Webhooks, guests, work handed in from elsewhere and
// anything unprovable never can.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import type { RoutineRunTrigger } from "./routines.ts";

type Card = { requestId?: string; answered?: string; answeredText?: string; dismissed?: boolean; autoApplied?: boolean; answeredBy?: { kind: string; person?: string } };
type Line = { id: string; role: string; peerAsk?: unknown; sender?: { id?: string }; card?: Card };

export interface OwnerTurn {
  request: { messageId?: string; generations: ReadonlySet<string>; stopped?: boolean; automation?: RoutineRunTrigger } | undefined;
  generation: string;
  thread: readonly Line[];
  /** Whoever opened the conversation chose its title, so they must be the owner too. */
  starters?: readonly (string | undefined)[];
  /** Words someone else chose: a "post" webhook's payload, or a report of a routine the owner did not write. */
  reportsFromOthers?: boolean;
  ownerPerson: (person: string | undefined) => boolean;
  cardAnswerer: (card: Card) => string | undefined;
  routineRun: () => { triggerSource: RoutineRunTrigger; ownerStarted: boolean; ownerAuthored: boolean } | null;
}

const personOf = (line: Line | undefined) => line?.role === "user" && !line.peerAsk ? line.sender?.id : undefined;

export type OwnerTurnRefusal = "unproven" | "not-owner" | "someone-else";

export function ownerTurnRefusal(turn: OwnerTurn): OwnerTurnRefusal | null {
  const { request } = turn;
  if (!request?.messageId || request.stopped || !request.generations.has(turn.generation)) return "unproven";
  const index = turn.thread.findIndex(line => line.id === request.messageId);
  if (index < 0) return "unproven";
  let owner: boolean;
  if (request.automation === undefined) {
    owner = turn.ownerPerson(personOf(turn.thread[index]));
  } else {
    const run = turn.routineRun();
    owner = request.automation !== "webhook" && Boolean(run) && run!.triggerSource !== "webhook" &&
      run!.ownerAuthored && (run!.triggerSource !== "manual" || run!.ownerStarted);
  }
  if (!owner) return "not-owner";
  // A conversation someone else opened (and named) is theirs, whoever writes in it.
  if (turn.starters?.some((person) => person !== undefined && !turn.ownerPerson(person))) return "someone-else";
  if (turn.reportsFromOthers) return "someone-else";
  // No line (sent, queued, steered or handed in) and no card answer by anyone else, ever; a routine's own prompt names nobody.
  const clean = ownerOnlyConversation(turn.thread, turn.ownerPerson, turn.cardAnswerer,
    request.automation !== undefined ? request.messageId : undefined);
  return clean ? null : "someone-else";
}

/** Every user line and every answered card is the owner's. */
export function ownerOnlyConversation(
  thread: readonly Line[],
  ownerPerson: (person: string | undefined) => boolean,
  cardAnswerer: (card: Card) => string | undefined,
  exempt?: string,
): boolean {
  return thread.every(line =>
    (line.role !== "user" || line.id === exempt || ownerPerson(personOf(line))) &&
    (!answeredByPerson(line.card) || ownerPerson(cardAnswerer(line.card!))));
}

/** The harness's own settlements (dismissed, unavailable, a bot's change applied on its own, or a question a bot decided)
 * carry nobody's words. */
export function answeredByPerson(card: Card | undefined): boolean {
  if (!card || card.answeredBy?.kind === "bot") return false;
  return (Boolean(card.answered) && card.answered !== "unavailable" && card.dismissed !== true && card.autoApplied !== true) || Boolean(card.answeredText);
}

type RoutineShape = {
  prompt?: string; target?: unknown; botId?: string; groupId?: string; attachments?: { id: string; path: string }[];
  schedule?: unknown; runOn?: string;
};

/** The scheduler never rewrites these fields, so any edit by someone else changes the fingerprint. */
export function routineFingerprint(routine: RoutineShape): string {
  const attachments = (routine.attachments ?? []).map(attachment => [attachment.id, attachment.path]);
  return createHash("sha256").update(JSON.stringify([
    routine.prompt ?? "", routine.target ?? null, routine.botId ?? "", routine.groupId ?? null, attachments,
    routine.schedule ?? null, routine.runOn ?? null,
  ])).digest("hex");
}

const authorsFile = z.object({
  version: z.literal(1),
  routines: z.record(z.string().max(128), z.string().regex(/^[a-f0-9]{64}$/)),
  writers: z.record(z.string().max(128), z.string().regex(/^p_[\w-]{22}$/)).optional(),
}).strict();

/** A missing or damaged file means none: it never grants anything by being absent. */
export function createRoutineAuthors(file: string) {
  let routines: Record<string, string> = {};
  try {
    if (existsSync(file)) {
      const stat = lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1_000_000) routines = authorsFile.parse(JSON.parse(readFileSync(file, "utf8"))).routines;
    }
  } catch { routines = {}; }
  const save = () => writeFileAtomic(file, JSON.stringify({ version: 1, routines }), { mode: 0o600 });
  return {
    record(id: string, routine: RoutineShape) { routines = { ...routines, [id]: routineFingerprint(routine) }; save(); },
    forget(id: string) { if (Object.hasOwn(routines, id)) { const next = { ...routines }; delete next[id]; routines = next; save(); } },
    authored(id: string, routine: RoutineShape) { return Object.hasOwn(routines, id) && routines[id] === routineFingerprint(routine); },
    recorded(id: string): boolean { return Object.hasOwn(routines, id); },
    /** Writes the file even when nothing changed: its presence says records are being kept. */
    persist() { save(); },
  };
}
