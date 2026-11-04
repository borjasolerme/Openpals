// The one-time move that makes a server of the person's own their only home: chosen once on that server's circle ("Make …
// my home"), then run by one-home.mjs over cloud-send.mjs, which carry everything, stop this computer for good and switch
// on there what was on here, so no routine ever runs in two places. Every pass goes over this window's own sign-in at that
// server, as the person's: never a sign-in of its own, and never signed out here. The move's line shows on this
// computer's own page (`cloud-send:*`).
//
// Security: only a server that says this sign-in is its one owner's (server/own-home.ts) is ever chosen or written to, and
// the choice is bound to that server's identity, so another server behind the same address takes nothing of this
// computer's and is never lent it.
import { createLoginHandoffClient } from "./cloud-logins.mjs";
import { MOVE_LINE, resultKey } from "./cloud-send-parts.mjs";
import { createCloudSend, sendNotice } from "./cloud-send.mjs";
import { awayIn, createOneHome, parseJournal } from "./one-home.mjs";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ORIGIN = /^https?:\/\/[^/\s]+$/u;
const ENVIRONMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** How long a server's word on who owns it is kept for the rail. */
export const OWNER_KNOWN_MS = 10 * 60_000;
/** How long a server that did not say who owns it is left alone before it is asked again. */
export const OWNER_RETRY_MS = 60_000;
/** A chosen move that could not begin (this computer's server did not answer) looks again this often. */
const START_RETRY_MS = 30_000;

const tagged = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** This computer's server's answer to the move's freeze: frozen, or what still holds the move, by name ("" when it has
 * none) and what it is (server/routes/move-freeze.ts). */
export function freezeAnswer(got) {
  if (got.status === 409 && typeof got.body?.busy === "string") return { busy: got.body.busy, ...(typeof got.body.what === "string" ? { what: got.body.what } : {}) };
  if (!got.ok || got.body?.frozen !== true) throw Object.assign(new Error("Openpals on this computer could not pause."), { status: got.status });
  return { frozen: true };
}

async function answer(response) {
  const text = await response.text();
  try { return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null }; }
  catch { return { ok: response.ok, status: response.status, body: null }; }
}

/** The person's choice of home, read back; null when there is none or it is damaged. */
export function parseChoice(value) {
  if (!record(value) || value.v !== 1 || typeof value.id !== "string" || typeof value.origin !== "string" || !ORIGIN.test(value.origin)
    || typeof value.environmentId !== "string" || !ENVIRONMENT_ID.test(value.environmentId) || typeof value.name !== "string" || !value.name.trim()) return null;
  return value;
}

/** A saved place that is a server the person connected by hand: never This computer or a local environment. */
export const handSaved = (entry) => record(entry) && entry.kind === "remote" && typeof entry.origin === "string";

/**
 * This window's sign-in at a server, as one request after another: the session cookie, same-origin. `who()` is that
 * server's word on it: its identity, and whether it is this person's own.
 * @param {{ origin: string }} place
 * @param {typeof fetch} fetchImpl
 */
export function serverRequests(place, fetchImpl) {
  const request = (method, route, init = {}) => fetchImpl(`${place.origin}${route}`, {
    method, redirect: "error", credentials: "include", cache: "no-store", signal: AbortSignal.timeout(120_000), ...init,
    headers: { accept: "application/json", origin: place.origin, ...init.headers },
  });
  return {
    request,
    call: async (method, route, body) => answer(await request(method, route, body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })),
    async who() {
      const [session, described] = await Promise.all([request("GET", "/api/auth/session").then(answer), request("GET", "/.well-known/openmausbot/environment").then(answer)]);
      const signedIn = session.ok && session.body?.kind === "session";
      return { signedIn, own: signedIn && session.body.own === true, environmentId: typeof described.body?.environmentId === "string" ? described.body.environmentId : null,
        takesMove: Number(described.body?.capabilities?.move) >= 1, status: session.status };
    },
  };
}

/** The move's session at the chosen server: this window's own sign-in, checked to be its owner's, at the server chosen. */
export async function openServerSession(chosen, fetchImpl) {
  const server = serverRequests(chosen, fetchImpl);
  const who = await server.who();
  if (!who.signedIn) throw tagged(`This app isn't signed in to ${chosen.name}. Open ${chosen.name} in this app, then try again.`, "signed_out", { status: who.status === 403 ? 403 : 401 });
  if (who.environmentId !== chosen.environmentId) throw tagged(`The server at ${chosen.name}'s address is another one now, so nothing more goes there.`, "other_server");
  if (!who.own) throw tagged(`${chosen.name} has other people on it now, so your bots can't move there.`, "not_own");
  return {
    call: server.call,
    upload: async (route, bytes, type) => answer(await server.request("POST", route, { headers: { "content-type": type }, body: bytes })),
    fetch: (route, init = {}) => server.request(init.method ?? "GET", route, { ...init, headers: init.headers ?? {} }),
    close: async () => {},
  };
}

function jsonStore(store) {
  return { read: () => { try { return store.read(); } catch { return null; } }, write: (value) => store.write(value) };
}

/**
 * @param {{
 *   ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void },
 *   page(event: unknown): boolean,
 *   server(): { postMessage(message: unknown): void } | null | undefined,
 *   window(): { isDestroyed(): boolean, webContents: { send(channel: string, value: unknown): void, on?(event: string, listener: () => void): void, mainFrame: { url: string } } } | null,
 *   localOrigin(): string,
 *   localRequest(route: string, init?: RequestInit): Promise<Response>,
 *   fetch: typeof fetch,
 *   environments(): any[],
 *   journal: { read(): unknown, write(value: unknown): void },
 *   choice: { read(): unknown, write(value: unknown): void },
 *   sendState: { read(): unknown, write(value: unknown): void },
 *   lend?(projects: string[], place: any): Promise<unknown>,
 *   phone?: { paired(): boolean, stop(): Promise<void>, start(): Promise<void> },
 *   openHome?(place: any): void,
 *   version?: string,
 *   onChange?(): void,
 *   now?(): number,
 *   log?(line: string): void,
 * }} deps `page(event)`: the asking page is this computer's own. `server()`: this computer's server's process, whose
 * private port hands a moving secret to main alone. `window()`: the window whose page shows the move's line and whose
 * typing the move waits out. `localRequest`: this computer's server, as its owner. `fetch`: this window's own requests,
 * with its sign-ins.
 */
export function installOwnHome({ ipcMain, page, server, window, localOrigin, localRequest, fetch: fetchImpl, environments, journal: journalStore, choice: choiceStore, sendState, lend, phone, openHome,
  version, onChange = () => {}, now = Date.now, log = () => {} }) {
  const journal = jsonStore(journalStore), choice = jsonStore(choiceStore);
  const handoffClient = createLoginHandoffClient();
  const handoff = (what) => handoffClient.request(server(), what);
  let lastInput = 0;
  const watched = new WeakSet();
  /** When the person last typed or clicked in the window. */
  const typed = () => {
    const win = window();
    if (win && !win.isDestroyed() && !watched.has(win.webContents)) {
      watched.add(win.webContents);
      win.webContents.on?.("before-input-event", () => { lastInput = Date.now(); });
      // A watch set up just now has seen nothing yet: it counts as a key now, never as "typed long ago".
      lastInput = Math.max(lastInput, Date.now());
    }
    return lastInput;
  };
  const chosen = () => parseChoice(choice.read());
  const placeOf = (picked = chosen()) => (picked ? environments().find((entry) => handSaved(entry) && entry.origin === picked.origin) ?? null : null);
  const owners = new Map();

  const local = {
    call: async (method, route, body) => answer(await localRequest(route, { method, signal: AbortSignal.timeout(120_000),
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) })),
    async json(route) {
      const got = await local.call("GET", route);
      if (!got.ok) throw new Error("Openpals on this computer did not answer. Try again in a moment.");
      return got.body;
    },
  };
  const send = createCloudSend({
    local: (route, init) => localRequest(route, { method: init?.method ?? "GET", signal: AbortSignal.timeout(30_000) }),
    cloud: {
      origin: () => chosen()?.origin ?? null,
      open: () => openServerSession(chosen(), fetchImpl),
    },
    handoff,
    store: jsonStore(sendState),
    onChange: () => changed(),
  });
  /** The chosen server as the move sees it: always ready, never ended once home is there, since nothing ends it; until
   * then, a server forgotten in this app ends the move before anything runs there. */
  const target = () => {
    const picked = chosen();
    if (!picked) return null;
    return { origin: picked.origin, account: `own:${picked.environmentId}`, machine: picked.origin, ready: true, moves: true, name: picked.name,
      ended: !placeOf(picked) && !awayIn(parseJournal(journal.read())) };
  };
  const home = createOneHome({
    journal,
    cloud: target,
    send: { move: (options) => send.send({ reason: "move", final: options?.final === true }), check: () => send.check(), switches: () => send.switches(), snapshot: () => send.snapshot() },
    local: {
      ...local,
      freeze: async (origin) => freezeAnswer(await local.call("POST", "/api/move/freeze", { cloud: origin, place: chosen()?.name })),
      async unfreeze() {
        const got = await local.call("DELETE", "/api/move/freeze");
        if (!got.ok) throw Object.assign(new Error("Openpals on this computer could not go on again."), { status: got.status });
      },
      frozen: async () => (await local.json("/api/move/freeze"))?.frozen === true,
    },
    session: () => openServerSession(chosen(), fetchImpl),
    ...(lend ? { lend: (projects) => lend(projects, placeOf()) } : {}),
    ...(phone ? { phone } : {}),
    openHome: () => { const place = placeOf(); if (place) openHome?.(place); },
    lastInput: typed,
    ...(version ? { version } : {}),
    onChange: () => changed(),
    log,
  });

  /** The send's notice with the move's line, as this computer's page shows it. */
  const notice = () => {
    const line = home.view();
    return { ...sendNotice(send.snapshot()), ...(line ? { move: line } : {}) };
  };
  function changed() {
    const win = window();
    try {
      if (win && !win.isDestroyed() && new URL(win.webContents.mainFrame.url).origin === localOrigin()) win.webContents.send("cloud-send:notice-changed", notice());
    } catch {}
    onChange();
  }
  const onPage = (channel, handler) => (event, ...args) => {
    if (!page(event)) throw new Error(`${channel} is only available in this app's window`);
    return handler(...args);
  };
  ipcMain.handle("cloud-send:notice", onPage("cloud-send:notice", notice));
  ipcMain.handle("cloud-send:dismiss", onPage("cloud-send:dismiss", (signature) => {
    if (String(signature) !== MOVE_LINE) { send.dismiss(String(signature)); return notice(); }
    // The done line says what the move brought; the move's own send result is not said again after it.
    home.seen();
    const last = send.snapshot().last;
    if (last) send.dismiss(resultKey(last));
    return notice();
  }));
  // The move's Try again, after a day of failing.
  ipcMain.handle("cloud-send:move-retry", onPage("cloud-send:move-retry", async () => { await home.retry(); return notice(); }));

  /** The asks under way, one per server. */
  const asking = new Map();
  /** The server's own word on whether this window's sign-in there is its one owner's, kept OWNER_KNOWN_MS. A server that
   * did not say is left alone for OWNER_RETRY_MS. */
  function owner(place) {
    const pending = asking.get(place.id);
    if (pending) return pending;
    const ask = (async () => {
      try {
        const who = await serverRequests(place, fetchImpl).who();
        const known = { own: who.own && who.takesMove && who.environmentId !== null, environmentId: who.environmentId, at: now() };
        const before = owners.get(place.id);
        owners.set(place.id, known);
        if (before?.own !== known.own) onChange();
        return known;
      } catch (error) {
        log(`own home: ${place.name} did not say who owns it (${error?.message ?? error})`);
        const before = owners.get(place.id);
        owners.set(place.id, { own: false, environmentId: null, at: now(), unanswered: true });
        if (before?.own) onChange();
        return { own: false, environmentId: null, at: now() };
      } finally {
        asking.delete(place.id);
      }
    })();
    asking.set(place.id, ask);
    return ask;
  }
  const owns = (place) => {
    const known = handSaved(place) ? owners.get(place.id) : null;
    return Boolean(known?.own) && now() - known.at < OWNER_KNOWN_MS;
  };
  const moving = () => Boolean(parseJournal(journal.read()));
  let retry = null;
  /** Goes on with the move; a choice whose server was forgotten here before anything ran there is let go of, and one whose
   * move could not begin yet begins once it can. */
  async function kick() {
    if (retry) { clearTimeout(retry); retry = null; }
    await home.kick();
    const picked = chosen();
    if (!picked || moving()) return;
    if (!placeOf(picked)) { choice.write(null); changed(); return; }
    retry = setTimeout(() => { retry = null; void kick().catch((error) => log(`own home: ${error?.message ?? error}`)); }, START_RETRY_MS);
    retry.unref?.();
  }

  return {
    kick,
    /** Home is the chosen server: its switch happened. */
    away: () => home.away(),
    /** A server of the person's own is chosen as home. */
    active: () => Boolean(chosen()),
    /** The chosen server's address while home is there: This computer is no place of its own then. */
    origin: () => (home.away() ? chosen()?.origin ?? null : null),
    /** The chosen server while home is there: this computer is lent to it. */
    home() {
      const picked = chosen(), place = placeOf(picked);
      return picked && place && home.away() ? { id: place.id, origin: picked.origin, environmentId: picked.environmentId, name: place.name } : null;
    },
    /** A server connected by hand whose own word, fresh, is that it is this person's alone (read again now and then,
     * `refresh`). */
    owns,
    /** A server whose circle may offer "Make … my home": theirs alone, and no move under way or done. */
    offers(place) {
      return !moving() && !chosen() && owns(place);
    },
    /** Asks each server connected by hand who owns it, unless it said so lately. */
    refresh() {
      for (const place of environments().filter(handSaved)) {
        const known = owners.get(place.id);
        if (!known || now() - known.at >= (known.unanswered ? OWNER_RETRY_MS : OWNER_KNOWN_MS)) void owner(place);
      }
    },
    /** The person chose this server as their home: asked once more, then the move starts. */
    async start(id) {
      const place = environments().find((entry) => entry.id === id && handSaved(entry));
      if (!place) throw new Error("That server isn't in this app any more.");
      if (moving() || chosen()) throw new Error("Your bots are already moving.");
      const who = await serverRequests(place, fetchImpl).who().catch(() => null);
      if (!who?.signedIn) throw new Error(`This app isn't signed in to ${place.name}. Open ${place.name} in this app, then try again.`);
      if (!who.own) throw new Error(`${place.name} has other people on it, so your bots stay here. Only a server that's yours alone can be your bots' home.`);
      if (!who.takesMove || !who.environmentId) throw new Error(`Update Openpals on ${place.name} first, then try again.`);
      choice.write({ v: 1, id: place.id, origin: place.origin, environmentId: who.environmentId, name: place.name, at: now() });
      changed();
      void kick().catch((error) => log(`own home: ${error?.message ?? error}`));
      return { started: true };
    },
    close() { if (retry) clearTimeout(retry); retry = null; home.close(); },
    /** A handoff answer from this computer's server's private port (cloud-logins.mjs). */
    receive: handoffClient.receive,
  };
}
