/** The line this computer's page shows for the one-time move to a server of the person's own, named `place`. */
export type OneHomeView = OneHomePhase & { place?: string };
type OneHomePhase =
  /** `chats`: conversations gone of those to go; `failing`: it has failed for a day, with why; `updating`: the server is too
   * old to take a move and needs updating first. */
  | { phase: "copy"; chats?: { done: number; total: number }; failing?: { error: string | null }; updating?: true }
  /** `waitingFor`: the bot or room whose work holds the move ("" when it has no name), and `waitingWhat` what it is;
   * neither while it waits for a quiet moment or has not asked yet. */
  | { phase: "wait"; waitingFor?: string; waitingWhat?: "bot" | "room" | "sign-in"; failing?: { error: string | null } }
  | { phase: "finishing"; failing?: { error: string | null } }
  /** What arrived, checked on both sides; `at`: when the move was done; `phone`: a phone was paired with this computer. */
  | { phase: "done"; at?: number; counts?: OneHomeCounts; phone: boolean };
export interface OneHomeCounts { bots: number; skills: number; logins: number; onePassword: boolean; chats: number; routines: number }

/** The server the move goes to. `ended`: it was forgotten here before anything ran there. */
export interface OneHomeCloud {
  origin: string | null; account: string; machine: string | null; ready: boolean; moves: boolean; ended: boolean;
  /** The server by the name the person knows it by: the move's line says it. */
  name?: string;
}
type Answer = { ok: boolean; status: number; body: any };

export declare const QUIET_MS: number;
export declare const CHECK_PASSES: number;
export declare const FROZEN_RETRY_MS: number;
export declare const COPY_RETRY_MS: number[];
export declare const FAILING_LINE_MS: number;
export function parseJournal(value: unknown): Record<string, any> | null;
export function rateLimited(error: unknown): boolean;
/** Home is the server by this journal. */
export function awayIn(journal: Record<string, any> | null | undefined): boolean;
export function automationsOn(manifest: unknown): Record<string, boolean>;
export function switchOn(key: string): { method: string; route: string; body: unknown } | null;
export function arrivedCounts(here: unknown, there: unknown): OneHomeCounts;

export function createOneHome(deps: {
  journal: { read(): unknown; write(value: unknown): void };
  cloud(): OneHomeCloud | null;
  send: { move(options?: { final?: boolean }): Promise<unknown>; check(): Promise<{ ok: boolean }>; switches(): Record<string, boolean>; snapshot(): any };
  local: {
    freeze(origin: string): Promise<{ frozen: true } | { busy: string; what?: string }>;
    unfreeze(): Promise<void>;
    frozen(): Promise<boolean>;
    json(route: string): Promise<any>;
    call(method: string, route: string, body?: unknown): Promise<Answer>;
  };
  session(): Promise<{ call(method: string, route: string, body?: unknown): Promise<Answer>; close(): Promise<void> }>;
  lend?(projects: string[]): Promise<unknown>;
  phone?: { paired(): boolean; stop(): Promise<void>; start(): Promise<void> };
  openHome?(): void;
  lastInput?(): number;
  version?: string;
  onChange?(view: OneHomeView | null): void;
  now?(): number;
  timers?: { set(work: () => void, ms: number): unknown; clear(timer: unknown): void };
  log?(line: string): void;
}): {
  kick(): Promise<void>;
  view(): OneHomeView | null;
  away(): boolean;
  retry(): Promise<void>;
  seen(): OneHomeView | null;
  changed(): void;
  close(): void;
};
