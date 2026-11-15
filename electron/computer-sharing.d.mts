export interface SharedFolder { id: string; name: string; path: string; write: boolean; /** The person's whole home folder. */ home?: boolean }
/** Computer control's state as lending reads it. */
export interface ScreenStatus {
  ready: boolean;
  lent: boolean;
  reason: "starting" | "permissions" | "blocked" | "off" | "not-running" | "unsupported" | null;
  fix: "start" | "allow" | null;
  message?: string;
}
export type LendingProblem = "no-server" | "other-server" | "unsupported" | "signed-out" | "not-admin" | "unreachable" | "refused";
/** What lending tells the menu-bar item and the app's pages. */
export interface LendingSummary {
  on: boolean;
  paused: boolean;
  name: string;
  server: string | null;
  state: "off" | "connecting" | "online" | "offline" | "waiting" | "paused";
  problem?: LendingProblem;
  busy: { action: string } | null;
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
export function isHomeFolder(target: string): Promise<boolean>;
export function existingFolders<T>(folders: unknown[], validate: (folders: unknown[]) => Promise<T[]>): Promise<T[]>;
export function validateSharedFolders(folders: unknown, options?: { homeEdits?: boolean }): Promise<SharedFolder[]>;
export function validSharedOperation(operation: unknown, computerId: string): boolean;
export function parseLendingRecord(raw: unknown): unknown;
export interface ComputerSharing {
  view(): LendingView;
  summary(): LendingSummary;
  turnOn(options?: { name?: string }): LendingView;
  turnOff(): Promise<LendingView>;
  pause(): Promise<LendingView>;
  resume(): LendingView;
  rename(name: string): LendingView;
  setTerminal(on: boolean): LendingView;
  setScreen(on: boolean): LendingView;
  setFolders(folders: SharedFolder[]): LendingView;
  lentFolders(): SharedFolder[];
  activity(limit?: number): LendingActivityEntry[];
  serverChanged(): void;
  readScreen(): Promise<ScreenStatus | null>;
  close(): void;
}
export function createComputerSharing(options: {
  file: string;
  server: () => { origin: string; name: string } | null;
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
