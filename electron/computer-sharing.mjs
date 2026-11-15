// Lending this computer to the one server this app is paired with, so bots there can work on it: its apps and screen,
// the folders the person chose, and its terminal when they turn that on. Outbound HTTPS only: register, long-poll for a
// job, run it under the grant saved here, send the result back. No listening port, and the server never holds a
// credential of this computer: the poll carries this app's own paired session and a secret only main knows.
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

/** Why lending is not online, in a word the app's pages and the menu word for themselves. */
export const LENDING_PROBLEMS = Object.freeze(["no-server", "other-server", "unsupported", "signed-out", "not-admin", "unreachable", "refused"]);

const problem = (code, message) => Object.assign(new Error(message ?? code), { problem: code });

function cleanName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
}

/** A saved record from computer-sharing.json, or null for anything this version did not write. */
export function parseLendingRecord(raw) {
  const record = raw && typeof raw === "object" && raw.version === 2 ? raw : null;
  if (!record || !uuid(record.id) || !/^[a-f0-9]{64}$/.test(record.secret ?? "") || typeof record.origin !== "string") return null;
  const folders = Array.isArray(record.folders) ? record.folders.filter(folder => uuid(folder?.id) && typeof folder.path === "string" && typeof folder.write === "boolean") : [];
  return {
    version: 2, id: record.id, secret: record.secret, origin: record.origin,
    enabled: record.enabled === true, paused: record.paused === true, name: cleanName(record.name),
    folders: folders.slice(0, 20).map(({ id, path: where, name, write, home }) => ({ id, path: where, name: cleanName(name) || path.basename(where), write, ...(home === true ? { home: true } : {}) })),
    terminal: record.terminal === true, screen: record.screen !== false,
  };
}

/**
 * `server()`: the server this app is paired with now ({ origin, name }), or null on this computer's own bots.
 * `fetch`: carries this app's paired session cookie (Electron's session.fetch). `cuaConnection()`: computer control's
 * connection as cua.mjs published it. `screen()`: its state for the menu (screen-status.mjs). `hostControl(id, signal)`:
 * this computer's own screen lock, so its own bots and a lent call never use the screen at once. `computerName()`: the
 * name this computer goes by. `onChange(summary)`: the menu-bar item and the app's pages follow every change.
 */
export function createComputerSharing({
  file, server, fetch: fetchImpl, cuaConnection = async () => null, screen = async () => null, hostControl = null,
  screenLocked = () => false, idleSeconds = () => null, protectedPaths = [], home = os.homedir(),
  computerName = () => os.hostname(), platform = process.platform, onChange = () => {}, log = () => {},
  activityFile, retryMs = RETRY_MS, now = Date.now,
}) {
  const protectedRoots = [path.dirname(file), ...protectedPaths.filter(entry => typeof entry === "string" && entry), ...personalSecretPaths(home)];
  const activity = createLendingActivity(activityFile ?? path.join(path.dirname(file), "lending-activity.jsonl"));
  const presence = createLentScreenPresence({ idleSeconds, now });
  let record = null;
  try { record = parseLendingRecord(JSON.parse(fs.readFileSync(file, "utf8"))); } catch {}
  let live = null;
  let status = { state: "off" };
  let busy = null;
  let screenNow = null;
  let closed = false;

  const store = next => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
    record = next;
  };
  const target = () => {
    const paired = server();
    return paired && record && paired.origin === record.origin ? paired : null;
  };
  const nameNow = () => record?.name || cleanName(computerName()) || "This computer";
  const summary = () => ({
    on: record?.enabled === true, paused: record?.enabled === true && record.paused, name: nameNow(),
    server: server()?.name ?? null, state: status.state, ...(status.problem ? { problem: status.problem } : {}),
    busy, terminal: record?.terminal === true, lendsScreen: record?.screen !== false, screen: screenNow,
  });
  const changed = () => { if (!closed) try { onChange(summary()); } catch {} };
  const setStatus = next => { status = next; changed(); };

  const request = async (where, route, body, signal, secret) => {
    const origin = new URL(where.origin);
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && LOOPBACK.has(origin.hostname))) throw problem("refused", "Lending needs the server's HTTPS address");
    let response;
    try {
      response = await fetchImpl(`${where.origin}${route}`, {
        method: body === undefined ? "GET" : "POST", credentials: "include", redirect: "error", cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { origin: where.origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(secret ? { "x-omb-computer-secret": secret } : {}) },
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
    if (response.status === 401) throw problem("signed-out", "Pair this app with the server again");
    if (response.status === 404 || (json === null && response.ok)) throw problem("unsupported", "This server does not take work computers. Update Openpals on it.");
    if (!response.ok) throw Object.assign(problem(response.status === 403 ? "refused" : "unreachable", typeof json?.error === "string" ? json.error.slice(0, 300) : `Server answered ${response.status}`), { status: response.status });
    return json;
  };

  const registration = (folders, environmentId) => ({
    id: record.id, name: nameNow(), environmentId,
    folders: folders.map(({ id, name, write }) => ({ id, name, write })), terminal: record.terminal, computer: record.screen,
    ...(LENT_PLATFORMS.has(platform) ? { platform } : {}), commandTimeouts: true, longCommands: true, fileEdits: true,
  });

  const runJob = async (where, job, grant, signal, session) => {
    const call = (action, body) => request(where, `/api/shared-computers/${record.id}/${action}`, body, undefined, record.secret);
    busy = { action: job.operation.action };
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
      // Listing the tools never touches the screen, so only a call takes this computer's screen lock.
      if (job.operation.action === "computer_call" && grant.computer) {
        if (screenLocked()) throw new Error(SCREEN_LOCKED);
        const waits = presence.refusal(job.operation.tool_name, job.operation.arguments);
        if (waits) throw new Error(waits);
        if (hostControl) control = await hostControl(job.id, jobSignal);
        jobSignal.throwIfAborted();
      }
      result = await executeSharedOperation(grant, job.operation, jobSignal, async () => {
        if (!session.cua) {
          const connection = await cuaConnection();
          jobSignal.throwIfAborted();
          const mcp = sharedCuaConnection(connection);
          if (!mcp) throw new Error(cuaUnavailable(connection?.reason, platform));
          session.cua = createSharedCua(mcp, { platform });
        }
        return session.cua;
      });
    } catch (error) {
      result = sharedComputerError(error);
      session.cua?.close();
      session.cua = null;
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

  const connectOnce = async (signal, session) => {
    const where = target();
    if (!where) throw problem(server() ? "other-server" : "no-server");
    const [descriptor, auth] = await Promise.all([
      request(where, "/.well-known/openmausbot/environment"),
      request(where, "/api/auth/session"),
    ]);
    signal.throwIfAborted();
    if (auth?.kind !== "session") throw problem("signed-out");
    if (!Array.isArray(auth.scopes) || !auth.scopes.includes("admin")) throw problem("not-admin");
    if (auth.workComputers !== true) throw problem("unsupported");
    // A folder moved or deleted since is left out, so the rest keeps working.
    const folders = await existingFolders(record.folders, validateSharedFolders);
    const grant = { enabled: true, folders, terminal: record.terminal, computer: record.screen, protectedPaths: protectedRoots };
    signal.throwIfAborted();
    await request(where, "/api/shared-computers/connect", registration(folders, descriptor.environmentId), signal, record.secret);
    setStatus({ state: "online" });
    while (!signal.aborted) {
      const { job } = await request(where, `/api/shared-computers/${record.id}/poll`, {}, signal, record.secret);
      if (signal.aborted) break;
      if (!job) continue;
      if (!uuid(job.id)) throw problem("refused", "Invalid computer request");
      if (!validSharedOperation(job.operation, record.id)) {
        activity.record({ env: where, action: "invalid", detail: "", ok: false, error: "Refused a malformed request" });
        await request(where, `/api/shared-computers/${record.id}/result`, { jobId: job.id, result: sharedComputerError(new Error("Invalid computer request")) }, undefined, record.secret);
        continue;
      }
      await runJob(where, job, grant, signal, session);
    }
  };

  const stopLoop = () => {
    if (!live) return;
    live.abort.abort();
    live.session.cua?.close();
    live = null;
  };

  const startLoop = () => {
    stopLoop();
    if (closed || !record?.enabled || record.paused) { setStatus({ state: record?.enabled && record.paused ? "paused" : "off" }); return; }
    const current = { abort: new AbortController(), session: { cua: null } };
    live = current;
    const { signal } = current.abort;
    setStatus({ state: "connecting" });
    void (async () => {
      for (let failures = 0; !signal.aborted;) {
        try {
          await connectOnce(signal, current.session);
          failures = 0;
        } catch (error) {
          if (signal.aborted) break;
          const code = error?.problem ?? "unreachable";
          if (code !== "unreachable" || !error?.problem) log(`lending: ${code}: ${error?.message ?? error}`);
          setStatus({ state: code === "unreachable" ? "offline" : "waiting", problem: code });
          if (code === "other-server" || code === "no-server") break;
          failures++;
        }
        try { await delay(retryMs[Math.min(failures, retryMs.length - 1)], undefined, { signal }); } catch { break; }
      }
    })();
  };

  /** Tells the server this computer is paused or no longer lent, so its bots say so instead of "offline". */
  const sayGoodbye = (paused) => {
    const where = target();
    if (!where || !record) return Promise.resolve();
    return request(where, `/api/shared-computers/${record.id}/disconnect`, paused ? { paused: true } : {}, undefined, record.secret).catch(() => {});
  };

  const readScreen = async () => {
    const next = await Promise.resolve().then(screen).catch(() => null);
    if (JSON.stringify(next) !== JSON.stringify(screenNow)) { screenNow = next; changed(); }
    return next;
  };

  const update = patch => {
    if (!record) throw new Error("Turn lending on first");
    store({ ...record, ...patch });
    startLoop();
    return view();
  };

  const view = () => ({
    ...summary(),
    folders: (record?.folders ?? []).map(({ id, name, write, home: whole }) => ({ id, name, write, ...(whole ? { home: true } : {}) })),
    defaultName: cleanName(computerName()) || "This computer",
  });

  if (record?.enabled) startLoop();
  void readScreen();

  return {
    view,
    summary,
    /** Lends this computer to the server shown now, with apps and screen; folders and the terminal are added later. */
    turnOn({ name } = {}) {
      const paired = server();
      if (!paired) throw new Error("Connect this app to your server first");
      const same = record?.origin === paired.origin;
      store({
        version: 2, id: same ? record.id : randomUUID(), secret: same ? record.secret : randomBytes(32).toString("hex"), origin: paired.origin,
        enabled: true, paused: false, name: cleanName(name) || (same ? record.name : ""), folders: same ? record.folders : [],
        terminal: same ? record.terminal : false, screen: same ? record.screen : true,
      });
      startLoop();
      return view();
    },
    /** Stops lending at once; the server keeps the computer as no longer lent. */
    async turnOff() {
      if (!record?.enabled) return view();
      await sayGoodbye(false);
      store({ ...record, enabled: false, paused: false });
      stopLoop();
      setStatus({ state: "off" });
      return view();
    },
    async pause() {
      if (!record?.enabled || record.paused) return view();
      stopLoop();
      await sayGoodbye(true);
      store({ ...record, paused: true });
      setStatus({ state: "paused" });
      return view();
    },
    resume() {
      if (!record?.enabled) return view();
      return update({ paused: false });
    },
    rename: name => update({ name: cleanName(name) }),
    setTerminal: on => update({ terminal: on === true }),
    setScreen: on => update({ screen: on === true }),
    /** `folders` were checked by validateSharedFolders already. */
    setFolders: folders => update({ folders }),
    /** The lent folders with their paths, for main alone: a page and the server only ever see their names. */
    lentFolders: () => (record?.folders ?? []).map(folder => ({ ...folder })),
    activity: limit => activity.list(limit),
    /** The paired server changed: lending follows only the server it was turned on for. */
    serverChanged() {
      if (record?.enabled && !record.paused) startLoop();
      else changed();
    },
    readScreen,
    /** Quitting: nothing more reaches this computer; the server sees it go offline. */
    close() { stopLoop(); closed = true; },
  };
}
