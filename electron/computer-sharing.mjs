// Lending this computer to the servers the person added with a link from "Add a computer" (theirs, and anyone's at home
// they allow), so bots there can work on it: its apps and screen, the folders the person chose, and its terminal when
// they turn that on. Outbound HTTPS only: register, long-poll for a job, run it under the grant saved here, send the
// result back. No listening port. Each server gets its own lend-only session (it can do nothing else there) and a secret
// only main knows; one screen call runs at a time across all of them.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createSharedCua, executeSharedOperation, personalSecretPaths, sharedComputerError, validCommandSeconds } from "./shared-computer-access.mjs";
import { sharedCuaConnection } from "./shared-cua-connection.mjs";
import { createLendingActivity, describeSharedOperation } from "./lending-activity.mjs";
import { cuaUnavailable, SCREEN_LOCKED } from "./lent-screen-failures.mjs";
import { createLentScreenPresence } from "./lent-screen-presence.mjs";
import { shareableDrive } from "./shared-drives.mjs";

const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const DATA_VOLUME = "/System/Volumes/Data";
const identify = async candidate => { const info = await fsp.stat(candidate, { bigint: true }); return `${info.dev}:${info.ino}`; };

/** macOS reaches one home through a firmlink and again under the data volume, with different ancestors: walk both. */
function homeCandidates() {
  const home = path.resolve(os.homedir());
  const seeds = [home];
  if (process.platform === "darwin" && !home.startsWith(`${DATA_VOLUME}${path.sep}`)) seeds.push(path.join(DATA_VOLUME, home));
  return seeds;
}

/** {dev, ino}, not text: text misses firmlinks, bind mounts, case-insensitive spellings, Unicode normalization and 8.3/UNC names. */
async function enclosingHomeIdentities() {
  const identities = new Set();
  const [home, ...aliases] = homeCandidates();
  const canonicalHome = await fsp.realpath(home);
  const homeIdentity = await identify(canonicalHome);
  const roots = [canonicalHome];
  for (const alias of aliases) {
    try {
      const canonical = await fsp.realpath(alias);
      if ((await identify(canonical)) === homeIdentity) roots.push(canonical);
    } catch (error) {
      // Only the optional macOS data-volume spelling may be absent; any other failure must not shrink the home boundary.
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
  }
  for (let current of roots) {
    for (;;) {
      identities.add(await identify(current));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return identities;
}

/** Sharing a drive letter, root or mount point shares a whole volume; unreadable parents fail closed. */
async function volumeRoot(canonical) {
  const parent = path.dirname(canonical);
  if (parent === canonical) return true;
  try { return (await fsp.stat(parent, { bigint: true })).dev !== (await fsp.stat(canonical, { bigint: true })).dev; } catch { return true; }
}

/** Whether `target` is exactly the person's home folder. Only the home folder itself may be lent on request (see
 * `home` in validateSharedFolders); the folders above it, and the system disk, never can. */

/** `promise`, or a rejection as soon as `signal` aborts, whichever comes first. */
function untilEnded(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error("The request ended"));
  return new Promise((resolve, reject) => {
    const ended = () => reject(new Error("The request ended"));
    signal.addEventListener("abort", ended, { once: true });
    Promise.resolve(promise).then(
      value => { signal.removeEventListener("abort", ended); resolve(value); },
      error => { signal.removeEventListener("abort", ended); reject(error); },
    );
  });
}
export async function isHomeFolder(target) {
  try {
    const [home] = homeCandidates();
    return (await identify(await fsp.realpath(target))) === (await identify(await fsp.realpath(home)));
  } catch { return false; }
}

const GONE = new Set(["ENOENT", "ENOTDIR"]);

/** The folders that still exist and pass the checks a folder chosen by hand passes. One moved or deleted since is left
 * out; any other refusal (the whole home folder, a file) still fails. */
export async function existingFolders(folders, validate) {
  const found = await Promise.all(folders.map((folder) => validate([folder]).then((list) => list[0] ?? null, (error) => {
    if (GONE.has(error?.code)) return null;
    throw error;
  })));
  return found.filter(Boolean);
}

/** `homeEdits`: the home folder keeps the editing it asks for; without it, the home folder is lent read only. */
export async function validateSharedFolders(folders, { homeEdits = false } = {}) {
  if (!Array.isArray(folders) || folders.length > 20) throw Object.assign(new Error("Choose at most 20 shared folders"), { code: "TOO_MANY" });
  const result = [];
  const enclosing = await enclosingHomeIdentities();
  for (const folder of folders) {
    if (!uuid(folder?.id) || typeof folder.path !== "string" || !path.isAbsolute(folder.path) || typeof folder.write !== "boolean") throw Object.assign(new Error("Choose folders using the desktop folder picker"), { code: "NOT_PICKED" });
    const canonical = await fsp.realpath(folder.path);
    if (!(await fsp.stat(canonical)).isDirectory()) throw Object.assign(new Error("Choose a folder, not a file"), { code: "NOT_FOLDER" });
    // The home folder, everything above it and the system disk are never shared. A separate drive (an external disk, a data
    // disk on a server, a drive letter) may be shared whole; any other mount point is still refused.
    // The home folder itself is lent only when asked for by name (`home: true`); anything above it, and the system disk,
    // are refused whatever is asked. Security: with editing, a write through it still never reaches its hidden files,
    // Library or AppData (insideHomeSettings), where shell start-up files and ~/.ssh live.
    const home = folder.home === true && await isHomeFolder(canonical);
    if (!home && (enclosing.has(await identify(canonical)) || ((await volumeRoot(canonical)) && !(await shareableDrive(canonical))))) throw Object.assign(new Error("Choose specific folders or a separate drive, not the entire computer or home folder"), { code: "HOME_OR_ROOT" });
    if (result.some(entry => entry.id === folder.id || entry.path === canonical)) continue;
    result.push({ id: folder.id, path: canonical, name: path.basename(canonical).slice(0, 120), write: home && !homeEdits ? false : folder.write, ...(home ? { home: true } : {}) });
  }
  return result;
}

const JOB_KEYS = new Set(["computer_id", "action", "folder_id", "path", "content", "encoding", "expected_sha256", "old_text", "new_text", "command", "timeout_seconds", "tool_name", "arguments"]);
const JOB_ACTIONS = new Set(["list_files", "read_file", "write_file", "edit_file", "append_file", "delete_file", "run_command", "computer_tools", "computer_call"]);
const optionalText = (value, max) => value === undefined || (typeof value === "string" && value.length <= max);
/** Refuses malformed input only; the grant still decides whether the operation is allowed. */
export function validSharedOperation(operation, computerId) {
  return Boolean(operation) && typeof operation === "object" && !Array.isArray(operation) &&
    Object.keys(operation).every(key => JOB_KEYS.has(key)) &&
    operation.computer_id === computerId && JOB_ACTIONS.has(operation.action) &&
    (operation.folder_id === undefined || uuid(operation.folder_id)) &&
    optionalText(operation.path, 2048) && optionalText(operation.content, 350_000) &&
    optionalText(operation.old_text, 350_000) && optionalText(operation.new_text, 350_000) &&
    (operation.encoding === undefined || operation.encoding === "utf8" || operation.encoding === "base64") &&
    (operation.expected_sha256 === undefined || (typeof operation.expected_sha256 === "string" && /^[a-f0-9]{64}$/.test(operation.expected_sha256))) &&
    optionalText(operation.command, 8000) && validCommandSeconds(operation.timeout_seconds) && optionalText(operation.tool_name, 100) &&
    (operation.arguments === undefined || (Boolean(operation.arguments) && typeof operation.arguments === "object" && !Array.isArray(operation.arguments)));
}


const LENT_PLATFORMS = new Set(["darwin", "win32", "linux"]);
const RETRY_MS = [2_000, 5_000, 15_000, 60_000];
/** The server's longest poll is 20 s; a request that has not answered by then plus slack never will. */
const POLL_TIMEOUT_MS = 35_000;
const REQUEST_TIMEOUT_MS = 10_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_TARGETS = 10;

/** Why lending to a server is not online, in a word the app's pages and the menu word for themselves. */
export const LENDING_PROBLEMS = Object.freeze(["unsupported", "signed-out", "unreachable", "refused"]);

const problem = (code, message) => Object.assign(new Error(message ?? code), { problem: code });

function cleanName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
}

const allowedOrigin = (url) => url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));

/** A link from "Add a computer" (https://host/pair#code=…&lend=1): the server and its one-time code, else null. */
export function parseLendLink(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text || /[\s\\]/.test(text)) return null;
  try {
    const url = new URL(text);
    if (!allowedOrigin(url) || url.username || url.password || url.search || !["/pair", "/pair/"].includes(url.pathname)) return null;
    const hash = new URLSearchParams(url.hash.slice(1));
    const code = hash.get("code");
    if (hash.get("lend") !== "1" || !code || !/^[A-Z0-9-]{12,16}$/i.test(code)) return null;
    return { origin: url.origin, code };
  } catch { return null; }
}

function parseTarget(raw) {
  if (!raw || typeof raw !== "object" || !uuid(raw.id) || !/^[a-f0-9]{64}$/.test(raw.secret ?? "") || typeof raw.token !== "string" || !raw.token.startsWith("omb_sess_")) return null;
  try { if (!allowedOrigin(new URL(raw.origin)) || new URL(raw.origin).origin !== raw.origin) return null; } catch { return null; }
  return { id: raw.id, origin: raw.origin, serverName: cleanName(raw.serverName) || new URL(raw.origin).host, token: raw.token, secret: raw.secret, paused: raw.paused === true };
}

/** A saved record from computer-sharing.json, or null for anything this version did not write. */
export function parseLendingRecord(raw) {
  const record = raw && typeof raw === "object" && raw.version === 3 ? raw : null;
  if (!record) return null;
  const folders = Array.isArray(record.folders) ? record.folders.filter(folder => uuid(folder?.id) && typeof folder.path === "string" && typeof folder.write === "boolean") : [];
  const targets = (Array.isArray(record.targets) ? record.targets : []).map(parseTarget).filter(Boolean).slice(0, MAX_TARGETS);
  return {
    version: 3, enabled: record.enabled !== false, paused: record.paused === true, name: cleanName(record.name),
    folders: folders.slice(0, 20).map(({ id, path: where, name, write, home }) => ({ id, path: where, name: cleanName(name) || path.basename(where), write, ...(home === true ? { home: true } : {}) })),
    terminal: record.terminal === true, screen: record.screen !== false, targets,
  };
}

const EMPTY_RECORD = Object.freeze({ version: 3, enabled: true, paused: false, name: "", folders: [], terminal: false, screen: true, targets: [] });

/**
 * `fetch`: plain HTTPS, no cookies: each server is reached with its own lend-only session. `cuaConnection()`: computer
 * control's connection as cua.mjs published it. `screen()`: its state for the menu (screen-status.mjs).
 * `hostControl(id, signal)`: this computer's own screen lock, so its own bots and a lent call never use the screen at
 * once. `computerName()`: the name this computer goes by. `onChange(summary)`: the menu-bar item and the app's pages
 * follow every change.
 */
export function createComputerSharing({
  file, fetch: fetchImpl, cuaConnection = async () => null, screen = async () => null, hostControl = null,
  screenLocked = () => false, idleSeconds = () => null, protectedPaths = [], home = os.homedir(),
  computerName = () => os.hostname(), platform = process.platform, onChange = () => {}, log = () => {},
  activityFile, retryMs = RETRY_MS, now = Date.now,
}) {
  const protectedRoots = [path.dirname(file), ...protectedPaths.filter(entry => typeof entry === "string" && entry), ...personalSecretPaths(home)];
  const activity = createLendingActivity(activityFile ?? path.join(path.dirname(file), "lending-activity.jsonl"));
  const presence = createLentScreenPresence({ idleSeconds, now });
  let record = { ...EMPTY_RECORD };
  try { record = parseLendingRecord(JSON.parse(fs.readFileSync(file, "utf8"))) ?? record; } catch {}
  /** target id → its live loop and where it stands. */
  const loops = new Map();
  const statuses = new Map();
  let busy = null;
  let screenNow = null;
  let closed = false;
  // A screen call waits for another one here, so two servers never drive the screen at once even without hostControl.
  let screenTurn = Promise.resolve();
  // One connection to computer control for every server and every job: cua-driver remembers which windows were read
  // (get_window_state) in it, so a click after a read must reach the same one. Replaced only once its process ended.
  let cua = null;
  const controlNow = async (signal) => {
    if (cua && !cua.closed()) return cua;
    const connection = await cuaConnection();
    signal.throwIfAborted();
    const mcp = sharedCuaConnection(connection);
    if (!mcp) throw new Error(cuaUnavailable(connection?.reason, platform));
    if (!cua || cua.closed()) cua = createSharedCua(mcp, { platform });
    return cua;
  };

  const store = next => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
    record = next;
  };
  const nameNow = () => record.name || cleanName(computerName()) || "This computer";
  const lending = () => record.enabled && !record.paused && record.targets.length > 0;
  const targetState = target => {
    if (!record.enabled) return { state: "off" };
    if (record.paused || target.paused) return { state: "paused" };
    return statuses.get(target.id) ?? { state: "connecting" };
  };
  /** The whole computer in one word for the menu: online when any server can use it now. */
  const overall = () => {
    if (!record.enabled || record.targets.length === 0) return "off";
    if (record.paused || record.targets.every(target => target.paused)) return "paused";
    const states = record.targets.map(target => targetState(target).state);
    for (const state of ["online", "connecting", "offline", "waiting"]) if (states.includes(state)) return state;
    return "paused";
  };
  const summary = () => {
    const targets = record.targets.map(target => ({ id: target.id, serverName: target.serverName, paused: target.paused, ...targetState(target) }));
    const reachable = targets.filter(target => !target.paused);
    return {
      on: record.enabled && record.targets.length > 0, paused: record.enabled && record.paused, name: nameNow(),
      server: reachable.map(target => target.serverName).join(", ") || null, state: overall(), targets,
      busy, terminal: record.terminal, lendsScreen: record.screen, screen: screenNow,
    };
  };
  const changed = () => { if (!closed) try { onChange(summary()); } catch {} };
  const setStatus = (id, next) => { statuses.set(id, next); changed(); };

  const request = async (target, route, body, signal) => {
    let response;
    try {
      response = await fetchImpl(`${target.origin}${route}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          ...(target.token ? { authorization: `Bearer ${target.token}` } : {}), ...(target.secret ? { "x-omb-computer-secret": target.secret } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw problem("unreachable", `The server didn't answer: ${error?.message ?? error}`);
    }
    const text = await response.text();
    if (text.length > 4_000_000) throw problem("refused", "Server response exceeded limit");
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (response.status === 401) throw problem("signed-out", "Add this computer again with a new link from Add a computer");
    if (response.status === 404 || (json === null && response.ok)) throw problem("unsupported", "This server does not take work computers. Update Openpals on it.");
    if (!response.ok) throw Object.assign(problem(response.status === 403 ? "refused" : "unreachable", typeof json?.error === "string" ? json.error.slice(0, 300) : `Server answered ${response.status}`), { status: response.status });
    return json;
  };

  const registration = (target, folders, environmentId) => ({
    id: target.id, name: nameNow(), environmentId,
    folders: folders.map(({ id, name, write }) => ({ id, name, write })), terminal: record.terminal, computer: record.screen,
    ...(LENT_PLATFORMS.has(platform) ? { platform } : {}), commandTimeouts: true, longCommands: true, fileEdits: true,
    ...(record.screen ? { screenReady: screenNow?.ready === true } : {}),
  });

  /** One screen call at a time across every server this computer is lent to. A job its server ended stops waiting for the
   * screen at once, so one stuck call never holds every later job. */
  const takeScreen = async (id, signal) => {
    let release;
    const mine = new Promise(resolve => { release = resolve; });
    const before = screenTurn;
    screenTurn = before.then(() => mine);
    try { await untilEnded(before, signal); } catch (error) { release(); throw error; }
    const host = hostControl ? await hostControl(id, signal).catch(error => { release(); throw error; }) : null;
    return {
      renew: () => host?.renew() ?? Promise.resolve(),
      release: async () => { try { await untilEnded(host?.release(), AbortSignal.timeout(5_000)); } catch {} finally { release(); } },
    };
  };

  const runJob = async (target, job, grant, signal) => {
    const where = { origin: target.origin, name: target.serverName };
    const call = (action, body) => request(target, `/api/shared-computers/${target.id}/${action}`, body);
    busy = { action: job.operation.action, server: target.serverName };
    changed();
    const jobAbort = new AbortController();
    const jobSignal = AbortSignal.any([signal, jobAbort.signal]);
    let leasing = false, ended = false, renewal = null, control = null;
    const lease = async () => {
      if (leasing) return;
      leasing = true;
      try {
        if (!(await call("lease", { jobId: job.id })).active) jobAbort.abort();
        if (!ended) await (renewal = control?.renew());
      } catch { jobAbort.abort(); }
      finally { leasing = false; renewal = null; }
    };
    const heartbeat = setInterval(() => void lease(), 1000);
    let result;
    try {
      await lease();
      jobSignal.throwIfAborted();
      // Listing the tools never touches the screen, so only a call takes the screen.
      if (job.operation.action === "computer_call" && grant.computer) {
        if (screenLocked()) throw new Error(SCREEN_LOCKED);
        const waits = presence.refusal(job.operation.tool_name, job.operation.arguments);
        if (waits) throw new Error(waits);
        control = await takeScreen(job.id, jobSignal);
        jobSignal.throwIfAborted();
      }
      // A step that ignores the abort (a hung helper, a dialog) still ends the job when its server ends it.
      result = await untilEnded(executeSharedOperation(grant, job.operation, jobSignal, () => controlNow(jobSignal)), jobSignal);
    } catch (error) {
      // A refused or failed action keeps the connection, and with it what the driver read; only a dead one is replaced.
      result = sharedComputerError(error);
    } finally {
      clearInterval(heartbeat);
      ended = true;
      if (control) presence.acted(job.operation.tool_name, job.operation.arguments);
      await renewal?.catch(() => {});
      await control?.release().catch(() => {});
      busy = null;
      changed();
    }
    activity.record({
      env: where, action: job.operation.action, detail: describeSharedOperation(grant, job.operation), ok: result?.isError !== true,
      error: result?.isError === true ? result?.content?.[0]?.text : undefined,
    });
    // Never retried: an action whose result did not arrive may have run.
    await call("result", { jobId: job.id, result }).catch(error => log(`lending: result not delivered: ${error?.message ?? error}`));
  };

  const connectOnce = async (target, signal) => {
    const descriptor = await request(target, "/.well-known/openmausbot/environment");
    signal.throwIfAborted();
    // A folder moved or deleted since is left out, so the rest keeps working.
    const folders = await existingFolders(record.folders, validateSharedFolders);
    const grant = { enabled: true, folders, terminal: record.terminal, computer: record.screen, protectedPaths: protectedRoots };
    signal.throwIfAborted();
    await request(target, "/api/shared-computers/connect", registration(target, folders, descriptor.environmentId), signal);
    setStatus(target.id, { state: "online" });
    while (!signal.aborted) {
      const { job } = await request(target, `/api/shared-computers/${target.id}/poll`, {}, signal);
      if (signal.aborted) break;
      if (!job) continue;
      if (!uuid(job.id)) throw problem("refused", "Invalid computer request");
      if (!validSharedOperation(job.operation, target.id)) {
        activity.record({ env: { origin: target.origin, name: target.serverName }, action: "invalid", detail: "", ok: false, error: "Refused a malformed request" });
        await request(target, `/api/shared-computers/${target.id}/result`, { jobId: job.id, result: sharedComputerError(new Error("Invalid computer request")) });
        continue;
      }
      await runJob(target, job, grant, signal);
    }
  };

  const stopLoop = id => {
    const live = loops.get(id);
    if (!live) return;
    live.abort.abort();
    loops.delete(id);
  };
  const stopAll = () => { for (const id of loops.keys()) stopLoop(id); };

  const startLoop = target => {
    stopLoop(target.id);
    statuses.delete(target.id);
    if (closed || !lending() || target.paused) { changed(); return; }
    const current = { abort: new AbortController() };
    loops.set(target.id, current);
    const { signal } = current.abort;
    setStatus(target.id, { state: "connecting" });
    void (async () => {
      for (let failures = 0; !signal.aborted;) {
        try {
          await connectOnce(target, signal);
          failures = 0;
        } catch (error) {
          if (signal.aborted) break;
          const code = error?.problem ?? "unreachable";
          if (code !== "unreachable" || !error?.problem) log(`lending to ${target.serverName}: ${code}: ${error?.message ?? error}`);
          setStatus(target.id, { state: code === "unreachable" ? "offline" : "waiting", problem: code });
          failures++;
        }
        try { await delay(retryMs[Math.min(failures, retryMs.length - 1)], undefined, { signal }); } catch { break; }
      }
    })();
  };
  const startAll = () => { stopAll(); for (const target of record.targets) startLoop(target); changed(); };

  /** Tells a server this computer is paused or no longer lent there, so its bots say so instead of "offline". */
  const sayGoodbye = (target, paused) =>
    request(target, `/api/shared-computers/${target.id}/disconnect`, paused ? { paused: true } : {}).catch(() => {});

  const readScreen = async () => {
    const next = await Promise.resolve().then(screen).catch(() => null);
    if (JSON.stringify(next) !== JSON.stringify(screenNow)) {
      const readyChanged = (next?.ready === true) !== (screenNow?.ready === true);
      screenNow = next;
      // Each server hears whether its bots can use the screen now (its "Add a computer" guide says what is missing).
      if (readyChanged && lending()) startAll();
      else changed();
    }
    return next;
  };

  const update = patch => {
    store({ ...record, ...patch });
    startAll();
    return view();
  };
  const withTarget = (id, patch) => update({ targets: record.targets.map(target => (target.id === id ? { ...target, ...patch } : target)) });
  const find = id => {
    const target = record.targets.find(entry => entry.id === id);
    if (!target) throw new Error("This server is no longer in the list");
    return target;
  };

  const view = () => ({
    ...summary(),
    folders: record.folders.map(({ id, name, write, home: whole }) => ({ id, name, write, ...(whole ? { home: true } : {}) })),
    defaultName: cleanName(computerName()) || "This computer",
  });

  if (lending()) startAll();
  void readScreen();

  return {
    view,
    summary,
    /** The server's own name, from its public description, to ask the person about before anything is exchanged. */
    async serverName(origin) {
      const descriptor = await request({ origin, token: "", secret: "" }, "/.well-known/openmausbot/environment").catch(() => null);
      return cleanName(descriptor?.label) || new URL(origin).host;
    },
    /**
     * Lends this computer to the server of a link from "Add a computer", once `confirm(serverName)` said yes: trades the
     * one-time code for this computer's own lend-only session there and starts lending. The same server again replaces
     * its old session. Throws when the link can't be used.
     */
    async addTarget({ origin, code }, { serverName }) {
      if (!record.targets.some(target => target.origin === origin) && record.targets.length >= MAX_TARGETS) throw new Error(`This computer can be lent to at most ${MAX_TARGETS} servers`);
      const response = await fetchImpl(`${origin}/api/auth/pair`, {
        method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "content-type": "application/json" }, body: JSON.stringify({ code, label: nameNow() }),
      }).catch(error => { throw problem("unreachable", `The server didn't answer: ${error?.message ?? error}`); });
      const answer = await response.json().catch(() => null);
      if (!response.ok || typeof answer?.token !== "string" || !answer.token.startsWith("omb_sess_")) {
        throw new Error(typeof answer?.error === "string" ? answer.error.slice(0, 300) : "This link was already used or has expired. Make a new one in Add a computer.");
      }
      const previous = record.targets.find(target => target.origin === origin);
      if (previous) { stopLoop(previous.id); void sayGoodbye(previous, false); }
      const target = { id: randomUUID(), origin, serverName: cleanName(answer?.environment?.label) || serverName, token: answer.token, secret: randomBytes(32).toString("hex"), paused: false };
      // Lending to a new server lends what its question says: apps and screen, with commands off until turned on again.
      update({ enabled: true, paused: false, terminal: false, targets: [...record.targets.filter(entry => entry.origin !== origin), target] });
      return view();
    },
    /** Stops lending to one server and signs this computer out there. */
    async removeTarget(id) {
      const target = find(id);
      stopLoop(id);
      await sayGoodbye(target, false);
      await request(target, "/api/auth/logout", {}).catch(() => {});
      return update({ targets: record.targets.filter(entry => entry.id !== id) });
    },
    async pauseTarget(id) {
      const target = find(id);
      if (target.paused) return view();
      stopLoop(id);
      await sayGoodbye(target, true);
      return withTarget(id, { paused: true });
    },
    resumeTarget: id => { find(id); return withTarget(id, { paused: false }); },
    /** Lending on again, to every server in the list. */
    turnOn() {
      if (record.targets.length === 0) throw new Error("Paste the link from Add a computer first");
      return update({ enabled: true, paused: false, terminal: false });
    },
    /** Stops lending everywhere at once; the servers stay in the list for Turn on. */
    async turnOff() {
      if (!record.enabled) return view();
      const goodbyes = record.targets.filter(target => !target.paused).map(target => sayGoodbye(target, false));
      stopAll();
      store({ ...record, enabled: false, paused: false });
      changed();
      await Promise.all(goodbyes);
      return view();
    },
    async pause() {
      if (!lending()) return view();
      const goodbyes = record.targets.filter(target => !target.paused).map(target => sayGoodbye(target, true));
      stopAll();
      store({ ...record, paused: true });
      changed();
      await Promise.all(goodbyes);
      return view();
    },
    resume() {
      if (!record.enabled) return view();
      return update({ paused: false });
    },
    rename: name => update({ name: cleanName(name) }),
    setTerminal: on => update({ terminal: on === true }),
    setScreen: on => update({ screen: on === true }),
    /** `folders` were checked by validateSharedFolders already. */
    setFolders: folders => update({ folders }),
    /** The lent folders with their paths, for main alone: a page and the servers only ever see their names. */
    lentFolders: () => record.folders.map(folder => ({ ...folder })),
    activity: limit => activity.list(limit),
    readScreen,
    /** Quitting: nothing more reaches this computer; the servers see it go offline. */
    close() { stopAll(); cua?.close(); cua = null; closed = true; },
  };
}
