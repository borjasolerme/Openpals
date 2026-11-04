import type { PlanRow, SendKind } from "./cloud-send-parts.mjs";

export type CloudSendPlace = "none" | "unreachable" | "outdated" | "signed-out" | "local-unavailable" | "ready";

export interface CloudSendResult {
  /** Bots added to the server, by name. */
  bots: string[];
  /** Bots the server had, updated with what changed here. */
  updatedBots: string[];
  skills: number;
  logins: number;
  onePassword: boolean;
  /** "profile" and/or "language". */
  settings: string[];
  /** Apps and keys a move carried (MCP servers, AI keys, HighLevel, connected apps); 0 or absent for any other send. */
  connections?: number;
  /** The chats the server lacked, added by row or by Bring newer chats; null when this send did not bring chats. `left`:
   * conversations that did not all go this time (a bot answering in one, or the server not taking a page yet). */
  chats: { conversations: number; messages: number; left?: number } | null;
  failed: Array<{ key: string; kind: SendKind | "chats" | "connection" | "memory" | "files"; label: string; error: string; final?: true }>;
  /** A move's own: automations and skill extras it carried, memory files and learned facts merged, bot files sent (`kept`:
   * beside a different file of the server's), and conversations whose own settings it set. */
  moved?: number;
  memory?: number;
  files?: { sent: number; kept: number };
  conversationSettings?: number;
  /** model: kept the server's engine; settings: a setting the server refused; narrowed: a login kept to bots the server lacks; memory: notes not copied. */
  notes: Array<{ kind: "model" | "settings" | "narrowed" | "memory"; bot?: string; login?: string }>;
}
/** `error`: the send failed as a whole (nothing after that point went), in words for the person. */
export interface CloudSendOutcome { at: number; reason: string; result: CloudSendResult; error?: string }
/** What did not go, grouped by reason (bots by name, logins only counted, at most three reasons), and `error`: why the
 * send stopped as a whole. */
export interface CloudSendFailure {
  /** `connections`: apps and keys a move could not carry; absent from an older desktop. */
  reasons?: Array<{ what: { bots: string[]; skills: number; logins: number; onePassword: boolean; settings: number; connections?: number; chats: boolean }; error: string }>;
  error?: string;
}

export interface CloudSendSnapshot {
  cloud: CloudSendPlace;
  running: null | { reason: string; progress?: { done: number; total: number }; phase?: "chats" };
  rows: PlanRow[];
  cloudOnly: Array<{ key: string; kind: SendKind; label: string; detail?: string; bot?: string }>;
  pending: number;
  /** This computer's conversations still to go; null when the server is too old to take chats by row, or not compared yet. */
  chats: { waiting: number } | null;
  signature: string;
  dismissed: string;
  last: CloudSendOutcome | null;
  /** The latest send of everything (Send everything, a move), which a later send of one login or item never replaces. */
  whole: CloudSendOutcome | null;
  /** What reached the server from this computer, all sends together. */
  arrived: CloudSendArrived;
  cloudVersion: string | null;
  localVersion: string | null;
}

/** What this computer's page is told of the move: names of this computer's bots that wait, and counts, never logins' sites. */
export interface CloudSendNotice {
  ready: boolean;
  bots: string[];
  updatedBots: string[];
  skills: number;
  logins: number;
  onePassword: boolean;
  settings: number;
  signature: string;
  dismissed: boolean;
  running: boolean;
  /** The running pass's reason ("move"), progress and phase. */
  runningReason?: string;
  progress?: { done: number; total: number };
  phase?: "chats";
  /** `sent`: counts only; `seen`: the person closed this result on the strip. */
  /** `final`: every failure is one trying again can't fix (1Password refused the token), so no Try again. */
  last: CloudSendTold | null;
  /** The latest pass of everything. */
  whole: CloudSendTold | null;
  /** What reached the server from this computer, all passes together. */
  arrived: CloudSendArrived;
  /** The one-time move's own line, while there is one. */
  move?: import("./one-home.mjs").OneHomeView;
}
export type CloudSendTold = { at: number; reason: string; failed: number; seen: boolean; sent: CloudSendCounts; final?: boolean } & CloudSendFailure;
export interface CloudSendArrived extends CloudSendCounts { chats: { conversations: number; messages: number } }
export interface CloudSendCounts {
  bots: number; updatedBots: number; skills: number; logins: number; onePassword: boolean; settings: number;
  chats: { conversations: number; messages: number } | null;
}

export interface CloudSendPageBridge {
  notice(): Promise<CloudSendNotice>;
  dismiss(signature: string): Promise<CloudSendNotice>;
  /** The move's Try again, after a day of failing. */
  moveRetry(): Promise<CloudSendNotice>;
  onNotice(listener: (notice: CloudSendNotice) => void): () => void;
}

export interface CloudSendSession {
  call(method: string, route: string, body?: unknown): Promise<{ status: number; ok: boolean; body: any }>;
  upload(route: string, bytes: Uint8Array, type: string): Promise<{ status: number; ok: boolean; body: any }>;
  /** The answer as it came, for a download; only the owner sessions main opens have it. */
  fetch?(route: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export class CloudSendError extends Error {
  code: string;
  constructor(code: string, message: string, options?: { cause?: unknown });
}
export function unanswered(error: unknown): boolean;

export function botPatch(bot: Record<string, unknown>, parts: string[], cloudBots: ReadonlySet<string>): Record<string, unknown>;
export function parseSendState(value: unknown): { v: 1; clouds: Record<string, any> };
export function sendNotice(snapshot: CloudSendSnapshot): CloudSendNotice;

/** What a move's check found missing on the server (cloud-send-check.mjs); `ok` when nothing is. */
export interface CloudMoveCheck {
  ok: boolean;
  gaps: {
    items: Array<{ key: string; kind: SendKind; label: string }>;
    parts: Array<{ key: string; label: string; parts: string[] }>;
    memory: Array<{ bot: string; path: string }>;
    rooms: Array<{ id: string; name: string }>;
    connections: string[];
    conversations: string[];
    /** Bot files by path, finished routine runs by id, bots whose journal rows, learned facts and teams whose pieces, and
     * conversations whose own settings the server lacks. */
    files: string[];
    runs: string[];
    journal: string[];
    learned: string[];
    teams: string[];
    settings: string[];
  };
  /** Per conversation: rows the server lacks, lines of its owner's it holds that do not carry the owner yet, and whether
   * this computer's visible path is the server's ("equal"), appears in order inside a longer one ("inside", both sides added
   * to it) or does not hold ("broken"). */
  chats: Array<{ threadId: string; missing: number; unstamped: number; path: "equal" | "inside" | "broken" }>;
  attachments: string[];
  /** Credentials by id, compared by fingerprint only. */
  secrets: { equal: string[]; differs: string[]; missing: string[] };
}

export function createCloudSend(deps: {
  local(route: string, init?: { method?: string }): Promise<Response>;
  cloud: {
    origin(): string | null;
    /** The move's session. */
    open(options?: { move?: boolean }): Promise<CloudSendSession>;
  };
  handoff(what: { kind: string; [key: string]: unknown }): Promise<any>;
  store: { read(): unknown; write(value: unknown): void };
  onChange?(snapshot: CloudSendSnapshot): void;
  now?(): number;
  /** How long a move waits for the server to run the engines whose keys it just took. */
  engineWaitMs?: number;
}): {
  snapshot(): CloudSendSnapshot;
  /** One pass of everything this computer has, apps and keys first; `final`: the pass after this computer stopped, which
   * carries the sign-ins that refresh themselves and lets go of this computer's copies. */
  send(options?: { final?: boolean }): Promise<CloudSendOutcome>;
  check(): Promise<CloudMoveCheck>;
  /** Each automation a move carried ("routine:<id>", "call:<id>", "webhook:<id>", "app-event:<id>") and whether it was
   * on here when it went. */
  switches(): Record<string, boolean>;
  dismiss(signature: string): CloudSendSnapshot;
};
