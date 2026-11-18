export interface SharedFolder { id: string; name: string; path: string; write: boolean; /** The person's whole home folder. */ home?: boolean }
/** Computer control's state as lending reads it. */
export interface ScreenStatus {
  ready: boolean;
  lent: boolean;
  reason: "starting" | "permissions" | "blocked" | "off" | "not-running" | "unsupported" | null;
  fix: "start" | "allow" | null;
  message?: string;
}
export type LendingProblem = "unsupported" | "signed-out" | "unreachable" | "refused";
export type LendingState = "off" | "connecting" | "online" | "offline" | "waiting" | "paused";
/** One server this computer is lent to, added with a link from its "Add a computer". */
export interface LendingTarget {
  id: string;
  serverName: string;
  paused: boolean;
  state: LendingState;
  problem?: LendingProblem;
}
/** What lending tells the menu-bar item and the app's pages. */
export interface LendingSummary {
  /** Lent to at least one server, and not stopped. */
  on: boolean;
  paused: boolean;
  name: string;
  /** The servers it is lent to now, by name, for the menu's line. */
  server: string | null;
  state: LendingState;
  targets: LendingTarget[];
  busy: { action: string; server: string } | null;
  terminal: boolean;
  lendsScreen: boolean;
  screen: ScreenStatus | null;
}
export interface LendingView extends LendingSummary {
  folders: Array<Omit<SharedFolder, "path">>;
  defaultName: string;
}
export interface LendingActivityEntry { at: number; server: string; origin: string; action: string; detail: string; ok: boolean; error?: string }
export const LENDING_PROBLEMS: readonly LendingProblem[];
export function parseLendLink(input: unknown): { origin: string; code: string } | null;
export function isHomeFolder(target: string): Promise<boolean>;
export function existingFolders<T>(folders: unknown[], validate: (folders: unknown[]) => Promise<T[]>): Promise<T[]>;
export function validateSharedFolders(folders: unknown, options?: { homeEdits?: boolean }): Promise<SharedFolder[]>;
export function validSharedOperation(operation: unknown, computerId: string): boolean;
export function parseLendingRecord(raw: unknown): unknown;
export interface ComputerSharing {
  view(): LendingView;
  summary(): LendingSummary;
  serverName(origin: string): Promise<string>;
  addTarget(link: { origin: string; code: string }, options: { serverName: string }): Promise<LendingView>;
  removeTarget(id: string): Promise<LendingView>;
  pauseTarget(id: string): Promise<LendingView>;
  resumeTarget(id: string): LendingView;
  turnOn(): LendingView;
  turnOff(): Promise<LendingView>;
  pause(): Promise<LendingView>;
  resume(): LendingView;
  rename(name: string): LendingView;
  setTerminal(on: boolean): LendingView;
  setScreen(on: boolean): LendingView;
  setFolders(folders: SharedFolder[]): LendingView;
  lentFolders(): SharedFolder[];
  activity(limit?: number): LendingActivityEntry[];
  readScreen(): Promise<ScreenStatus | null>;
  close(): void;
}
export function createComputerSharing(options: {
  file: string;
  fetch: typeof fetch;
  cuaConnection?: () => Promise<unknown>;
  screen?: () => Promise<ScreenStatus | null>;
  hostControl?: ((id: string, signal: AbortSignal) => Promise<{ renew(): Promise<void>; release(): Promise<void> }>) | null;
  screenLocked?: () => boolean;
  idleSeconds?: () => number | null;
  protectedPaths?: string[];
  home?: string;
  computerName?: () => string;
  platform?: NodeJS.Platform;
  onChange?: (summary: LendingSummary) => void;
  log?: (line: string) => void;
  activityFile?: string;
  retryMs?: number[];
  now?: () => number;
}): ComputerSharing;
