// The one-time move that makes a server of the person's own their only home (own-home-main.mjs). cloud-send.mjs carries
// everything; this runs it once, in phases, and keeps where it is in one journal, so each launch goes on from there:
//
//   copy    everything goes while this computer stays home and fully usable
//   wait    until a quiet moment: no work under way here (server/move-waits.ts), and nobody typing for 30 s
//   freeze  this computer's server stops (server/move-freeze.ts): no turns, schedules, webhooks or app events
//   final   the same pass again, for what changed since, with the sign-ins that refresh themselves
//   check   what arrived, against what is here; anything missing goes again, three passes at most
//   switch  the server switches on what was on here, and keeps which computer its bots came from
//   done    home is that server: this computer lends itself, stops its phone link, and says once what arrived
//
// Before the switch a failure lifts the freeze and tries again later; from the switch on the move only goes forward, so
// nothing ever runs in two places.

import { failureOf, rateLimited } from "./move-failure.mjs";

export { rateLimited };

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sentence = (value) => (typeof value === "string" && value.trim() ? value.trim().replace(/\s+/gu, " ").slice(0, 300) : null);

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const QUIET_MS = 30_000;
const BUSY_POLL_MS = 5_000;
/** The longest a timer waits before it looks again: longer ones overflow Node's timers. */
const LONGEST_WAIT_MS = 6 * HOUR;
export const CHECK_PASSES = 3;
/** A failure while this computer's server is frozen: lifted, and tried again in an hour. */
export const FROZEN_RETRY_MS = HOUR;
/** A failure before the freeze (no network, the server updating): tried again sooner at first, then hourly. */
export const COPY_RETRY_MS = [2 * MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR];
export const FAILING_LINE_MS = DAY;
const PHASES = new Set(["copy", "wait", "freeze", "final", "check", "switch", "done"]);
const FROZEN = new Set(["freeze", "final", "check"]);
/** The phases in which home is the server: this computer's phone link stays off. */
const AWAY = new Set(["switch", "done"]);
const AUTOMATION = /^(routine|call|webhook|app-event):([\w-]{1,128})$/u;

/** At most this many ids of a kind in the log line. */
const LOGGED_IDS = 10;
const ID = /^[\w-]{1,200}$/u;
/** Rooms and conversations are named by their ids, never their names: what a person can be asked about, nothing they wrote. */
const IDS_OF = { rooms: (entry) => entry?.id, conversations: (entry) => entry, settings: (entry) => entry };
const named = (ids) => {
  const kept = ids.filter((id) => typeof id === "string" && ID.test(id));
  return kept.length ? ` (${kept.slice(0, LOGGED_IDS).join(", ")}${kept.length > LOGGED_IDS ? `, ${kept.length - LOGGED_IDS} more` : ""})` : "";
};

/** What a check found missing, by kind and count, and the rooms and conversations by id: "3 rooms (r1, r2, r3), 1 memory". */
export function missingOf(report) {
  const counts = Object.entries(record(report?.gaps) ? report.gaps : {}).flatMap(([kind, list]) => (Array.isArray(list) && list.length
    ? [`${list.length} ${kind}${IDS_OF[kind] ? named(list.map(IDS_OF[kind])) : ""}`] : []));
  const chats = (Array.isArray(report?.chats) ? report.chats : []).filter((entry) => entry.missing || entry.unstamped || entry.path === "broken");
  const secrets = (report?.secrets?.differs?.length ?? 0) + (report?.secrets?.missing?.length ?? 0);
  return [...counts, ...(chats.length ? [`${chats.length} chat paths${named(chats.map((entry) => entry.threadId))}`] : []), ...(report?.attachments?.length ? [`${report.attachments.length} attachments`] : []),
    ...(secrets ? [`${secrets} credentials`] : [])].join(", ") || "something";
}

/** A move's stage: a freeze that finds work under way goes back to waiting, which is the same wait. */
const stageOf = (phase) => (phase === "freeze" ? "wait" : phase);
/** A failure of the move's own, with the code it is reported by. */
const tagged = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** A journal read back, kept to its known shape; null when there is none. */
export function parseJournal(value) {
  if (!record(value) || value.v !== 1 || !PHASES.has(value.phase) || !record(value.cloud) || typeof value.cloud.origin !== "string" || typeof value.cloud.account !== "string") return null;
  return value;
}

/** Home is the server by this journal: its switch happened. */
export const awayIn = (journal) => AWAY.has(journal?.phase ?? "");

/** How one automation is switched on, over the routes its own page uses. */
export function switchOn(key) {
  const match = AUTOMATION.exec(key);
  if (!match) return null;
  const [, kind, id] = match;
  if (kind === "routine") return { method: "PATCH", route: `/api/routines/${id}`, body: { enabled: true } };
  // A call is on when it has a next time: saving it again works that out from its schedule.
  if (kind === "call") return { method: "PATCH", route: `/api/calendar-calls/${id}`, body: {} };
  if (kind === "webhook") return { method: "PATCH", route: `/api/webhooks/${id}`, body: { enabled: true } };
  return { method: "PATCH", route: `/api/app-triggers/${id}`, body: { enabled: true } };
}

/** Each automation a manifest lists, by key, and whether it is on. */
export function automationsOn(manifest) {
  return Object.fromEntries((Array.isArray(manifest?.automations) ? manifest.automations : [])
    .filter((entry) => record(entry) && typeof entry.key === "string" && AUTOMATION.test(entry.key) && typeof entry.on === "boolean").map((entry) => [entry.key, entry.on]));
}

/** What arrived, in counts a person recognises: only what both sides hold, this computer's manifest against the server's. */
export function arrivedCounts(here, there) {
  const keys = new Set((there?.items ?? []).map((item) => item.key));
  const items = (here?.items ?? []).filter((item) => keys.has(item.key));
  const count = (...kinds) => items.filter((item) => kinds.includes(item.kind)).length;
  const threads = new Set((there?.conversations ?? []).map((head) => head.threadId));
  const automations = new Set((there?.automations ?? []).map((entry) => entry.key));
  return {
    bots: count("bot"), skills: count("skill", "imported-skill", "library-skill"), logins: count("login"), onePassword: count("1password") > 0,
    chats: (here?.conversations ?? []).filter((head) => threads.has(head.threadId)).length,
    routines: (here?.automations ?? []).filter((entry) => entry.key.startsWith("routine:") && automations.has(entry.key)).length,
  };
}

/**
 * @param {{
 *   journal: { read(): unknown, write(value: unknown): void },
 *   cloud(): null | { origin: string | null, account: string, machine: string | null, name?: string, ready: boolean, moves: boolean, ended: boolean },
 *   send: { move(options?: { final?: boolean }): Promise<unknown>, check(): Promise<{ ok: boolean }>, switches(): Record<string, boolean>, snapshot(): any },
 *   local: { freeze(origin: string): Promise<{ frozen: true } | { busy: string, what?: string }>, unfreeze(): Promise<void>, frozen(): Promise<boolean>, json(route: string): Promise<any>,
 *     call(method: string, route: string, body?: unknown): Promise<{ ok: boolean, status: number, body: any }> },
 *   session(): Promise<{ call(method: string, route: string, body?: unknown): Promise<{ ok: boolean, status: number, body: any }>, close(): Promise<void> }>,
 *   lend?(projects: string[]): Promise<unknown>,
 *   phone?: { paired(): boolean, stop(): Promise<void>, start(): Promise<void> },
 *   openHome?(): void,
 *   lastInput?(): number,
 *   version?: string,
 *   onChange?(view: unknown): void,
 *   now?(): number,
 *   timers?: { set(work: () => void, ms: number): unknown, clear(timer: unknown): void },
 *   log?(line: string): void,
 * }} deps `cloud()`: the server the move goes to; `ended` once it was forgotten here before anything ran there.
 */
export function createOneHome(deps) {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? { set: (work, ms) => { const timer = setTimeout(work, ms); timer.unref?.(); return timer; }, clear: (timer) => clearTimeout(timer) };
  const log = deps.log ?? (() => {});
  let running = null, again = false, timer = null, closed = false, waitingFor = null, waitingWhat = null, wasReady = null;

  const read = () => parseJournal(deps.journal.read());
  const publish = () => { try { deps.onChange?.(view()); } catch {} };
  /** Each stage the journal enters is dated (`phaseAt`), so how long a move has stood still is known after a relaunch too. */
  const write = (journal) => {
    const next = journal && stageOf(read()?.phase) !== stageOf(journal.phase) ? { ...journal, phaseAt: now() } : journal;
    deps.journal.write(next);
    publish();
    return next;
  };
  const later = (ms) => {
    if (closed) return;
    if (timer) timers.clear(timer);
    timer = timers.set(() => { timer = null; void kick(); }, Math.min(LONGEST_WAIT_MS, Math.max(250, ms)));
  };

  /** What the line on this computer's page says: the phase, its progress, who it waits for, a day of failing, and the
   * done line until it is closed; `place`, the server the move goes to, by its name. Null when there is nothing to say. */
  function view() {
    const seen = phaseView(), place = read()?.cloud?.name;
    return seen && typeof place === "string" ? { ...seen, place } : seen;
  }

  function phaseView() {
    const journal = read();
    if (!journal || journal.paused || journal.told) return null;
    if (journal.phase === "done") return { phase: "done", ...(Number.isSafeInteger(journal.doneAt) ? { at: journal.doneAt } : {}), ...(journal.counts ? { counts: journal.counts } : {}), phone: journal.phone === true };
    const running = deps.send.snapshot?.()?.running;
    const chats = journal.phase === "copy" && running?.phase === "chats" && running.progress ? { done: running.progress.done, total: running.progress.total } : null;
    if (journal.phase === "copy" && journal.updating && !running) return { phase: "copy", updating: true };
    const failing = journal.failingSince && now() - journal.failingSince >= FAILING_LINE_MS ? { error: journal.error ?? null } : null;
    const phase = FROZEN.has(journal.phase) || journal.phase === "switch" ? "finishing" : journal.phase;
    const waits = phase === "wait" && waitingFor !== null ? { waitingFor, ...(waitingWhat ? { waitingWhat } : {}) } : {};
    return { phase, ...(chats ? { chats } : {}), ...waits, ...(failing ? { failing } : {}) };
  }

  /** Lifts this computer's freeze; true once it is lifted. */
  async function thaw(journal) {
    try { await deps.local.unfreeze(); } catch (error) { log(`one home: could not lift the freeze yet (${error?.message ?? error})`); later(MINUTE); return false; }
    const { thaw: _, ...rest } = journal;
    write(rest);
    return true;
  }

  /** The move fails here: a frozen server is lifted, and it all goes again later from the copy. A frozen pass waits an
   * hour, unless the server only said "too many requests" (429), which it lifts within minutes. */
  async function failed(journal, error, frozen) {
    const said = sentence(error?.message) ?? "The server did not answer.";
    log(`one home: ${journal.phase} failed (${said})`);
    const tries = (journal.tries ?? 0) + 1;
    const hourly = frozen && !rateLimited(error);
    const next = write({ ...journal, phase: "copy", passes: 0, tries, error: said, failingSince: journal.failingSince ?? now(), failure: failureOf(error, journal.phase, journal.failure, now()),
      retryAt: now() + (hourly ? FROZEN_RETRY_MS : COPY_RETRY_MS[Math.min(tries - 1, COPY_RETRY_MS.length - 1)]), hourly: hourly || undefined, ...(frozen ? { thaw: true } : {}) });
    if (frozen) await thaw(next);
    return null;
  }

  async function copy(journal) {
    waitingFor = waitingWhat = null;
    try { await deps.send.move(); }
    catch (error) { return error?.code === "outdated" ? updating(journal, error) : failed({ ...journal, updating: undefined }, error, false); }
    return write({ ...journal, phase: "wait", retryAt: undefined, hourly: undefined, updating: undefined });
  }

  /** The server is too old to take a move: the move starts once it is updated, so this is not the move failing and there
   * is nothing to try again. */
  function updating(journal, error) {
    log(`one home: the move waits for the server to update (${sentence(error?.message) ?? "too old"})`);
    const tries = (journal.tries ?? 0) + 1;
    write({ ...journal, phase: "copy", updating: true, tries, retryAt: now() + COPY_RETRY_MS[Math.min(tries - 1, COPY_RETRY_MS.length - 1)] });
    return null;
  }

  async function wait(journal) {
    const quietFor = now() - (deps.lastInput?.() ?? 0);
    if (quietFor < QUIET_MS) { later(QUIET_MS - quietFor); return null; }
    // The journal says "freeze" before the server is frozen: a crash in between resumes frozen, never forgotten.
    return freeze(write({ ...journal, phase: "freeze" }));
  }

  async function freeze(journal) {
    let answer;
    try { answer = await deps.local.freeze(journal.cloud.origin); }
    catch (error) { return failed(journal, error, true); }
    if (record(answer) && typeof answer.busy === "string") {
      // The server names what holds the move, and lets go of anything that is not a turn answering now within half an
      // hour (server/move-waits.ts), so this poll ends by itself.
      waitingFor = answer.busy;
      waitingWhat = typeof answer.what === "string" ? answer.what : null;
      write({ ...journal, phase: "wait" });
      later(BUSY_POLL_MS);
      return null;
    }
    waitingFor = waitingWhat = null;
    return write({ ...journal, phase: "final", frozenAt: now() });
  }

  async function final(journal) {
    try { await deps.send.move({ final: true }); }
    catch (error) { return failed(journal, error, true); }
    return write({ ...journal, phase: "check", passes: 1 });
  }

  async function check(journal) {
    let passes = journal.passes ?? 1;
    try {
      for (let report = await deps.send.check(); report?.ok !== true; report = await deps.send.check()) {
        log(`one home: the check found ${missingOf(report)} missing`);
        if (passes >= CHECK_PASSES) throw tagged("Some of this computer's things did not reach the server.", "incomplete");
        await deps.send.move({ final: true });
        passes += 1;
        write({ ...journal, passes });
      }
    } catch (error) { return failed({ ...journal, passes }, error, true); }
    let counts = null;
    try {
      const session = await deps.session();
      try { counts = arrivedCounts(await deps.local.json("/api/cloud-send/manifest"), (await session.call("GET", "/api/cloud-send/manifest")).body); }
      finally { await session.close().catch(() => {}); }
    } catch {}
    return write({ ...journal, phase: "switch", passes, checkedAt: now(), ...(counts ? { counts } : {}) });
  }

  /** The point of no return: the server switches on what was on here, and keeps which computer its bots came from. What was
   * on here is read here, frozen since the freeze, over what each pass recorded as it carried it. */
  async function switchOver(journal) {
    const switches = { ...deps.send.switches(), ...automationsOn(await deps.local.json("/api/cloud-send/manifest").catch(() => null)) };
    const switched = { ...journal.switched };
    let session;
    try {
      session = await deps.session();
      for (const [key, on] of Object.entries(switches)) {
        const change = on && !switched[key] ? switchOn(key) : null;
        if (!change) continue;
        const answer = await session.call(change.method, change.route, change.body);
        // One deleted there meanwhile stays deleted; any other refusal is tried again.
        if (!answer.ok && answer.status !== 404) throw tagged(sentence(answer.body?.error) ?? "The server did not switch on an automation.", "switch_refused", { status: answer.status });
        switched[key] = true;
        write({ ...journal, switched });
      }
      const computer = sentence((await deps.local.json("/api/cloud-connections").catch(() => null))?.computer?.label) ?? "this computer";
      const webhooks = Object.keys(switches).flatMap((key) => (key.startsWith("webhook:") ? [key.slice("webhook:".length)] : []));
      const arrived = await session.call("POST", "/api/cloud-send/arrived", { v: 1, computer, webhooks, ...(journal.cloud.name ? { place: journal.cloud.name } : {}) });
      if (!arrived.ok) throw tagged(sentence(arrived.body?.error) ?? "The server did not finish the move.", "switch_refused", { status: arrived.status });
    } catch (error) {
      log(`one home: switching over goes on later (${error?.message ?? error})`);
      const next = write({ ...journal, switched, error: sentence(error?.message) ?? undefined, retryAt: now() + 2 * MINUTE, failure: failureOf(error, "switch", journal.failure, now()) });
      later(next.retryAt - now());
      return null;
    } finally { await session?.close().catch(() => {}); }
    const done = write({ ...journal, phase: "done", switched, doneAt: now(), version: deps.version ?? null, phone: deps.phone?.paired() === true,
      error: undefined, failingSince: undefined, retryAt: undefined, tries: undefined, failure: undefined });
    await settle(done);
    deps.openHome?.();
    return null;
  }

  /** Once home is the server: the bots' project folders are lent to it with this computer, and its own phone link stops. */
  async function settle(journal) {
    let next = journal;
    if (!next.lent) {
      try {
        const bots = (await deps.local.json("/api/bots?messages=0"))?.bots ?? [];
        await deps.lend?.([...new Set(bots.map((bot) => bot?.cwd).filter((cwd) => typeof cwd === "string" && cwd))]);
        next = write({ ...next, lent: true });
      } catch (error) { log(`one home: this computer is lent later (${error?.message ?? error})`); }
    }
    if (!next.phoneStopped) {
      try {
        if (next.phone) await deps.phone?.stop();
        next = write({ ...next, phoneStopped: true });
      } catch (error) { log(`one home: the phone link stops later (${error?.message ?? error})`); }
    }
    return next;
  }

  /** Home is the server: tops up what a newer app learned to move. */
  async function steady(journal, cloud, waiting) {
    const next = await settle(journal);
    if (waiting || !deps.version || next.version === deps.version || !cloud?.ready) return;
    try { await deps.send.move({ final: true }); write({ ...next, version: deps.version, retryAt: undefined }); }
    catch (error) { log(`one home: the top-up waits (${error?.message ?? error})`); write({ ...next, retryAt: now() + HOUR }); }
  }

  async function run() {
    let journal = read();
    const cloud = deps.cloud();
    // A move left off while the server was away goes on as soon as it is back, unless it failed frozen: that waits its hour.
    const cameBack = cloud?.ready === true && wasReady === false;
    wasReady = cloud ? cloud.ready : null;
    const waiting = () => journal.retryAt > now() && !(cameBack && !journal.hourly);
    if (journal && cloud && cloud.account !== journal.cloud.account) {
      // Another server never moves this computer's copy, nor lifts its freeze once the move is done.
      if (FROZEN.has(journal.phase)) await failed(journal, tagged("Another server is chosen as home.", "other_account"), true);
      return;
    }
    if (!journal) {
      if (!cloud?.ready || !cloud.moves || cloud.ended || !cloud.origin) return;
      // A frozen server with no move under way is one this app no longer knows about: it is never lifted blindly.
      const held = await deps.local.frozen().then((frozen) => (frozen ? "frozen_without_move" : null), () => "local_unavailable");
      if (held) { log(`one home: ${held === "frozen_without_move" ? "this computer is frozen with no move under way" : "this computer's server did not say whether it is frozen"}`); return; }
      journal = write({ v: 1, phase: "copy", cloud: { origin: cloud.origin, account: cloud.account, machine: cloud.machine, ...(cloud.name ? { name: cloud.name } : {}) }, startedAt: now() });
    }
    if (journal.thaw && !(await thaw(journal))) return;
    journal = read() ?? journal;
    if (journal.phase === "done") return void await steady(journal, cloud, waiting());
    if (journal.phase === "switch" && waiting()) return void later(journal.retryAt - now());
    if (journal.phase !== "switch") {
      if (cloud?.ended || cloud && !cloud.moves) {
        // The server was forgotten here, or takes no moves, before the switch: a frozen server lifts.
        if (FROZEN.has(journal.phase) && !(await thaw({ ...journal, thaw: true }))) return;
        if (cloud.ended) { deps.journal.write(null); publish(); } else write({ ...(read() ?? journal), phase: "copy", paused: true });
        return;
      }
      if (!cloud?.ready) {
        if (FROZEN.has(journal.phase)) await failed(journal, tagged("The server is not ready.", "not_ready"), true);
        return;
      }
      if (journal.paused) journal = write({ ...journal, paused: undefined });
      if (journal.phase === "copy" && waiting()) { later(journal.retryAt - now()); return; }
    }
    for (let step = 0; journal && step < 12 && !closed; step++) {
      if (journal.phase === "copy") journal = await copy(journal);
      else if (journal.phase === "wait") journal = await wait(journal);
      else if (journal.phase === "freeze") journal = await freeze(journal);
      else if (journal.phase === "final") journal = await final(journal);
      else if (journal.phase === "check") journal = await check(journal);
      else if (journal.phase === "switch") journal = await switchOver(journal);
      else break;
    }
    const after = read();
    if (after?.phase === "copy" && after.retryAt) later(after.retryAt - now());
  }

  /** Goes on from where the journal is: at launch, on changes and when a wait is over. One run at a time. */
  async function kick() {
    if (closed) return;
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        try { await run(); } catch (error) { log(`one home: ${error?.message ?? error}`); later(MINUTE); }
      } while (again && !closed);
    })().finally(() => { running = null; publish(); });
    return running;
  }

  return {
    kick,
    view,
    /** Home is the server: the switch happened. */
    away: () => awayIn(read()),
    /** Try again, after a day of failing: now, not at the next hourly try. */
    retry() {
      const journal = read();
      if (journal?.phase === "copy") write({ ...journal, retryAt: undefined, hourly: undefined });
      return kick();
    },
    /** The done line was closed. */
    seen() {
      const journal = read();
      if (journal?.phase === "done" && !journal.told) write({ ...journal, told: true });
      return view();
    },
    /** A send's progress moved: the line follows it. */
    changed: publish,
    close() { closed = true; if (timer) timers.clear(timer); },
  };
}
