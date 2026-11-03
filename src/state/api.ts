// The renderer's JSON request helper. A page out of sight sends no background poll at all.
import { pageHidden, pageShown } from "../lib/page-visibility";
import { lacksAdminScope } from "../lib/admin-scope";
import { noteRefusedRequest } from "../lib/session-ended";

export class ApiError extends Error {
  readonly status: number;
  readonly body?: Record<string, unknown>;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type ApiInit = RequestInit & { timeoutMs?: number; background?: boolean };
/** Background reads waiting for a hidden page to show again, one per path: a poll that ticks while hidden asks once. */
const heldReads = new Map<string, Promise<unknown>>();

/** `background`: a poll nobody asked for just now. While the page is hidden (a background tab, a minimized window) it
 * waits until the page shows again. */
export async function api<T = any>(path: string, init?: ApiInit): Promise<T> {
  const { timeoutMs, signal, background, headers, ...rest } = init ?? {};
  if (background && pageHidden()) return heldUntilShown<T>(path, init!);
  const sent = new Headers(headers ?? { "content-type": "application/json" });
  const res = await fetch(path, {
    ...rest,
    headers: sent,
    signal: timeoutMs === undefined
      ? signal
      : signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body?.error;
    const message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : `${res.status} ${res.statusText}`;
    const refused = new ApiError(message, res.status, body);
    if (res.status === 401 || (res.status === 403 && !lacksAdminScope(refused))) noteRefusedRequest();
    throw refused;
  }
  return body;
}

/** A background request from a hidden page, sent once it shows again. Reads of one path without a signal of their own share
 * one request. */
function heldUntilShown<T>(path: string, init: ApiInit): Promise<T> {
  const shared = (init.method ?? "GET").toUpperCase() === "GET" && !init.signal;
  const waiting = shared ? heldReads.get(path) : undefined;
  if (waiting) return waiting as Promise<T>;
  const sent = pageShown(init.signal ?? undefined).then(() => api<T>(path, init));
  if (!shared) return sent;
  heldReads.set(path, sent);
  void sent.finally(() => { if (heldReads.get(path) === sent) heldReads.delete(path); }).catch(() => {});
  return sent;
}

/** A 200 that isn't the snapshot: `api` turns a non-JSON answer into `{}`, and the reducer can't take a missing list. The part
 * fails instead, which keeps what's on screen. */
export function snapshotArrays<T>(answer: T, ...keys: (keyof T)[]): T {
  for (const key of keys) if (!Array.isArray(answer[key])) throw new Error(`Invalid snapshot: ${String(key)} is not a list`);
  return answer;
}
