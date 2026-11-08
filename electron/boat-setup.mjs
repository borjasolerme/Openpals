// Sets up an always-on Openpals server on Boat with the person's Boat API key: Boat public API v1
// (https://docs.boat.dev/openapi/boat-v1.yaml). Security: the key lives only in this call's memory, goes only to
// boat.dev, and is never logged or saved.
import { appendOutput, createStepReader, INSTALLER_URL, lastLines, pairingLinkIn } from "./server-setup.mjs";

const API = "https://boat.dev/api/v1";
const PORT = 8799;
const LABEL = "Boat";
const MARK = { key: "app", value: "openpals" };
const LIVE_STATES = "init,provisioning,provisioned,cloning,ready,idle,running";
const READY_STATES = new Set(["ready", "idle", "running"]);
const DEAD_STATES = new Set(["error", "cancelled", "archiving", "archived"]);
const REQUEST_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 3_000;
const READY_TIMEOUT_MS = 10 * 60_000;
const INSTALL_POLL_MS = 2_000;
const INSTALL_TIMEOUT_MS = 40 * 60_000;
const MESSAGE_LIMIT = 300;

class SetupError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** What Boat said, as the person reads it: a wrong key, or Boat's own message (a plan or limit, capacity). */
function boatError(status, body) {
  const code = body?.code ?? body?.error?.code;
  if (status === 401 || (status === 403 && (!code || code === "forbidden" || code === "unauthorized"))) return new SetupError("boat-key");
  const message = String(body?.message ?? body?.error?.message ?? `HTTP ${status}`).slice(0, MESSAGE_LIMIT);
  return new SetupError("boat-refused", { message });
}

function boatClient({ key, fetch }) {
  return async function request(method, path, body) {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new SetupError("network");
    }
    const answer = await response.json().catch(() => null);
    if (!response.ok) throw boatError(response.status, answer);
    return answer ?? {};
  };
}

/** The machine an earlier attempt made (a closed window, a lost answer), so a retry never pays for a second one. */
async function existingMachine(request) {
  const query = new URLSearchParams({ label: `${MARK.key}=${MARK.value}`, state: LIVE_STATES });
  const { sandboxes = [] } = await request("GET", `/sandboxes?${query}`);
  return sandboxes[0] ?? null;
}

async function newMachine(request) {
  const { sandbox } = await request("POST", "/sandboxes", {
    name: "openpals",
    type: "small",
    ttlSeconds: null,
    labels: { [MARK.key]: MARK.value },
    // Security: the server runs bots with tools; it gets none of the account's secrets and cannot act on the account.
    noEnv: true,
  });
  if (!sandbox?.id) throw new SetupError("boat-refused", { message: "Boat did not return the new machine" });
  return sandbox;
}

async function waitUntilReady(request, machine, { sleep, now }) {
  const deadline = now() + READY_TIMEOUT_MS;
  let state = machine.state;
  while (!READY_STATES.has(state)) {
    if (DEAD_STATES.has(state)) throw new SetupError("boat-refused", { message: String(machine.error ?? `The machine is ${state}`).slice(0, MESSAGE_LIMIT) });
    if (now() > deadline) throw new SetupError("timeout");
    await sleep(READY_POLL_MS);
    ({ sandbox: machine } = await request("GET", `/sandboxes/${machine.id}`));
    state = machine?.state;
  }
}

async function publicOrigin(request, id) {
  const { url } = await request("POST", `/sandboxes/${id}/host`, { port: PORT, public: true, localhost: true });
  const origin = URL.canParse(url) ? new URL(url) : null;
  if (origin?.protocol !== "https:" || !/^[a-z0-9.-]+$/i.test(origin.hostname)) {
    throw new SetupError("boat-refused", { message: "Boat did not return an HTTPS address" });
  }
  return origin.origin;
}

/** The installer still running from an earlier attempt, so a retry follows it instead of starting a second one. */
async function runningInstaller(request, id) {
  try {
    const query = new URLSearchParams({ mode: "detached", q: "install-server.sh", limit: "1" });
    const { commands = [] } = await request("GET", `/sandboxes/${id}/command-history?${query}`);
    const last = commands[0];
    return last?.status === "running" && Number.isInteger(last.processId) ? last.processId : null;
  } catch (error) {
    if (error instanceof SetupError && error.code === "boat-refused") return null;
    throw error;
  }
}

async function startInstaller(request, id, origin) {
  const command = `curl -fsSL ${INSTALLER_URL} | bash -s -- --public-url ${origin} --label ${LABEL}`;
  const { processId } = await request("POST", `/sandboxes/${id}/commands`, { command, detached: true });
  if (!Number.isInteger(processId)) throw new SetupError("boat-refused", { message: "Boat did not start the installer" });
  return processId;
}

/** Follows the installer to its end and returns the pairing link it printed. */
async function followInstaller(request, id, processId, { sleep, now, onStep }) {
  const deadline = now() + INSTALL_TIMEOUT_MS;
  const readSteps = createStepReader(onStep);
  let log = "", stdoutOffset = 0, stderrOffset = 0;
  for (;;) {
    const query = new URLSearchParams({ stdoutOffset: String(stdoutOffset), stderrOffset: String(stderrOffset) });
    const status = await request("GET", `/sandboxes/${id}/commands/${processId}?${query}`);
    const fresh = `${status.stdout ?? ""}${status.stderr ?? ""}`;
    readSteps(status.stdout ?? "");
    log = appendOutput(log, fresh);
    stdoutOffset = status.stdoutNextOffset ?? stdoutOffset;
    stderrOffset = status.stderrNextOffset ?? stderrOffset;
    if (status.more) continue;
    if (!status.running) {
      const link = status.exitCode === 0 ? pairingLinkIn(log) : null;
      if (!link) throw new SetupError("install-failed", { output: lastLines(log) });
      return link;
    }
    if (now() > deadline) throw new SetupError("timeout");
    await sleep(INSTALL_POLL_MS);
  }
}

/**
 * Makes (or finds again) the person's "openpals" machine on Boat, keeps it on, gives it a public HTTPS address, runs the
 * installer there and returns the pairing link it printed. Steps go to `onProgress`: "creating", then "installing" with
 * the installer's own step lines as `detail`.
 */
export async function setupOnBoat({ key, onProgress = () => {}, fetch = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now }) {
  if (typeof key !== "string" || !key.trim()) return { ok: false, error: { code: "boat-key" } };
  const request = boatClient({ key: key.trim(), fetch });
  try {
    onProgress({ step: "creating" });
    const machine = (await existingMachine(request)) ?? (await newMachine(request));
    await waitUntilReady(request, machine, { sleep, now });
    const origin = await publicOrigin(request, machine.id);
    onProgress({ step: "installing" });
    const processId = (await runningInstaller(request, machine.id)) ?? (await startInstaller(request, machine.id, origin));
    const link = await followInstaller(request, machine.id, processId, { sleep, now, onStep: (detail) => onProgress({ step: "installing", detail }) });
    return { ok: true, link };
  } catch (error) {
    if (error instanceof SetupError) return { ok: false, error: { code: error.code, ...error.detail } };
    throw error;
  }
}
