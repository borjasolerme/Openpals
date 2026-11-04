import type { CompanionPairingRouteMode } from "./companion-pairing";

export type PhoneSetupPhase = "intro" | "verifying" | "qr" | "success";

/** `route`: the one the person chose to pair over (Tailscale or this network). */
export interface PhoneSetupFlowState {
  active: boolean;
  route: CompanionPairingRouteMode | null;
  baselineDeviceIds: string[];
  pairingAttempted: boolean;
  pairedDeviceName: string | null;
}

export type PhoneSetupEvent =
  | { type: "start"; deviceIds: string[]; route: CompanionPairingRouteMode }
  | { type: "pairing-opened"; deviceIds: string[] }
  | { type: "paired"; deviceName: string }
  | { type: "reset" };

export const initialPhoneSetupFlowState: PhoneSetupFlowState = {
  active: false,
  route: null,
  baselineDeviceIds: [],
  pairingAttempted: false,
  pairedDeviceName: null,
};

export function phoneSetupReducer(
  state: PhoneSetupFlowState,
  event: PhoneSetupEvent,
): PhoneSetupFlowState {
  switch (event.type) {
    case "start":
      return {
        active: true,
        route: event.route,
        baselineDeviceIds: [...event.deviceIds],
        pairingAttempted: false,
        pairedDeviceName: null,
      };
    case "pairing-opened":
      return {
        ...state,
        baselineDeviceIds: [...event.deviceIds],
        pairingAttempted: true,
      };
    case "paired":
      return { ...state, active: true, pairedDeviceName: event.deviceName };
    case "reset":
      return initialPhoneSetupFlowState;
  }
}

export function derivePhoneSetupPhase(flow: PhoneSetupFlowState, pairingOpen: boolean): PhoneSetupPhase {
  if (flow.pairedDeviceName) return "success";
  if (!flow.active) return "intro";
  if (pairingOpen || flow.pairingAttempted) return "qr";
  return "verifying";
}

export async function preparePhonePairingRoute<State extends { enabled: boolean; error?: string }>(
  routeMode: CompanionPairingRouteMode,
  alreadyEnabled: boolean,
  actions: {
    read: () => Promise<State>;
    start: () => Promise<State>;
    refreshTailscale: () => Promise<State>;
    shouldContinue?: () => boolean;
  },
): Promise<State> {
  let state = await (alreadyEnabled ? actions.read() : actions.start());
  if (
    alreadyEnabled
    && !state.enabled
    && (actions.shouldContinue?.() ?? true)
  ) {
    state = await actions.start();
  }
  if (
    routeMode === "tailscale"
    && state.enabled
    && !state.error
    && (actions.shouldContinue?.() ?? true)
  ) {
    state = await actions.refreshTailscale();
  }
  return state;
}

export function newlyPairedDevice<T extends { id: string; name: string }>(
  baselineDeviceIds: string[],
  devices: T[],
): T | null {
  const baseline = new Set(baselineDeviceIds);
  return devices.find((device) => !baseline.has(device.id)) ?? null;
}

export function newlyPairedDeviceForFlow<T extends { id: string; name: string }>(
  flow: Pick<PhoneSetupFlowState, "active" | "baselineDeviceIds" | "pairingAttempted" | "pairedDeviceName">,
  devices: T[],
): T | null {
  if (!flow.active || !flow.pairingAttempted || flow.pairedDeviceName) return null;
  return newlyPairedDevice(flow.baselineDeviceIds, devices);
}

export function phoneSetupBaseline<T extends { id: string }>(devices: T[] | null): string[] | null {
  return devices ? devices.map((device) => device.id) : null;
}

export interface PhonePairingAttemptLock {
  generation: number | null;
}

export function claimPhonePairingAttempt(
  lock: PhonePairingAttemptLock,
  generation: number,
): boolean {
  if (lock.generation === generation) return false;
  lock.generation = generation;
  return true;
}

export function releasePhonePairingAttempt(
  lock: PhonePairingAttemptLock,
  generation: number,
): boolean {
  if (lock.generation !== generation) return false;
  lock.generation = null;
  return true;
}

export interface PhonePairingQueuedRequest {
  generation: number;
}

export interface PhonePairingAttemptQueue<TRequest extends PhonePairingQueuedRequest> {
  active: TRequest | null;
  pending: TRequest | null;
}

export type PhonePairingQueueDecision = "start" | "queued" | "duplicate";

/** A newer request replaces the pending one, never the active one, so a late POST cannot replace a newer QR. */
export function queuePhonePairingAttempt<TRequest extends PhonePairingQueuedRequest>(
  queue: PhonePairingAttemptQueue<TRequest>,
  request: TRequest,
): PhonePairingQueueDecision {
  if (queue.active?.generation === request.generation
    || queue.pending?.generation === request.generation) return "duplicate";
  if (!queue.active) {
    queue.active = request;
    return "start";
  }
  queue.pending = request;
  return "queued";
}

export function completePhonePairingAttempt<TRequest extends PhonePairingQueuedRequest>(
  queue: PhonePairingAttemptQueue<TRequest>,
  generation: number,
): TRequest | null {
  if (queue.active?.generation !== generation) return null;
  const next = queue.pending;
  queue.active = next;
  queue.pending = null;
  return next;
}

export function invalidatePhonePairingAttempt(
  queue: PhonePairingAttemptQueue<PhonePairingQueuedRequest>,
  generation: number,
): void {
  if (queue.pending?.generation === generation) queue.pending = null;
}

interface PhonePairingWindowSnapshot {
  pairing: { code?: string; expiresAt?: number; token: string } | null;
}

const PAIRING_OPEN_FAILURE_MESSAGE =
  "Device pairing did not open. Open Advanced & troubleshooting, confirm Remote access is on, then try again.";

export function companionPairingOpenFailure(
  companion: PhonePairingWindowSnapshot & { enabled: boolean; error?: string },
  previousToken: string | null = null,
  now = Date.now(),
): string | null {
  const stateFailure = companionStartFailure(companion);
  if (stateFailure) return stateFailure;
  const pairing = companion.pairing;
  if (
    !pairing
    || pairing.token === previousToken
    || !/^omb_pair_[A-Za-z0-9_-]{43}$/.test(pairing.token)
    || !/^\d{6}$/.test(pairing.code ?? "")
    || !Number.isFinite(pairing.expiresAt)
    || (pairing.expiresAt ?? 0) <= now
  ) {
    return PAIRING_OPEN_FAILURE_MESSAGE;
  }
  return null;
}

/** Ownership is checked again right before the close, so an older completion cannot cancel a newer QR. */
export async function closePhonePairingIfOwned<TClosed>(
  opened: PhonePairingWindowSnapshot,
  current: () => Promise<PhonePairingWindowSnapshot>,
  close: () => Promise<TClosed>,
  mayClose: () => boolean,
): Promise<boolean> {
  const token = opened.pairing?.token;
  if (!token || !mayClose()) return false;
  let latest: PhonePairingWindowSnapshot;
  try {
    latest = await current();
  } catch {
    return false;
  }
  if (!mayClose() || latest.pairing?.token !== token) return false;
  try {
    await close();
    return true;
  } catch {
    return false;
  }
}

export async function keepPhonePairingIfCurrent<T, TClosed>(
  open: () => Promise<T>,
  close: (opened: T) => Promise<TClosed>,
  isCurrent: () => boolean,
): Promise<T | null> {
  const result = await open();
  if (isCurrent()) return result;
  await close(result).catch(() => {});
  return null;
}

export interface PhoneSetupPollTimer {
  set: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
}

export function startNonOverlappingPhoneSetupPoll<T>(
  poll: () => Promise<T>,
  intervalMs: number,
  timer: PhoneSetupPollTimer = {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle),
  },
): () => void {
  let stopped = false;
  let handle: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (stopped) return;
    handle = timer.set(() => {
      void Promise.resolve()
        .then(poll)
        .catch(() => {})
        .finally(schedule);
    }, intervalMs);
  };
  schedule();
  return () => {
    stopped = true;
    if (handle !== null) timer.clear(handle);
  };
}

const START_FAILURE_MESSAGE =
  "Remote access could not start. Open Advanced & troubleshooting, then try turning Remote access on again.";

export function companionStartFailure(
  companion: { enabled: boolean; error?: string },
): string | null {
  if (companion.enabled && !companion.error) return null;
  return companion.error?.trim() || START_FAILURE_MESSAGE;
}
