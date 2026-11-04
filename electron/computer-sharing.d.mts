export interface SharedFolder { id: string; name: string; path: string; write: boolean; /** The person's whole home folder. */ home?: boolean }
export interface SharingState {
  enabled: boolean;
  folders: SharedFolder[];
  terminal: boolean;
  computer: boolean;
  connected?: boolean;
  error?: string;
}
interface Workspace { id: string; name: string; origin: string }
interface Identity { sessionId: string; environmentId: string }
export interface LendingActivityEntry {
  at: number;
  server: string;
  origin: string;
  action: string;
  detail: string;
  ok: boolean;
  error?: string;
}
/** Computer control's state as lending reads it. */
export interface ScreenStatus {
  ready: boolean;
  lent: boolean;
  reason: "starting" | "permissions" | "blocked" | "off" | "not-running" | "unsupported" | null;
  fix: "start" | "allow" | null;
  message?: string;
}
/** A bot on the person's home server needs this computer and can't use it now. */
export interface ComputerAsk {
  id: string;
  need: "screen" | "folders" | "terminal";
  reason: string;
  bot: string;
  why?: string;
  state: "asking" | "turning-on" | "failed";
  /** Taps on the card's Turn on so far. */
  turnOn: number;
}
/** What lending tells the menu-bar item: the places lent to (while paused, the ones it would lend to) and using it now. */
export interface LendingSummary {
  lending: string[];
  clouds: string[];
  using: string[];
  paused: boolean;
  terminal?: boolean;
  busy: { env: string; action: string } | null;
  /** Computer control's latest state, null until it is first read. */
  screen: ScreenStatus | null;
}
export interface AutomaticGrant { folders: SharedFolder[]; screen: boolean; internet: true; chrome: true; terminal: false }
export type CloudLendingVerdict = { allow: true } | { pause: string } | { stop: "signed-out" | "account-changed" | "machine-changed" };
export function cloudLendingVerdict(binding: { accountId: string; origin: string } | null | undefined, current: { status: string; accountId: string | null; origin: string | null } | null, env: { origin: string } | null | undefined): CloudLendingVerdict;
/** The person said no to lending their home before lending was automatic, so lending starts Paused. */
export function saidNo(record: { enabled?: boolean; cloud?: unknown; internet?: boolean; stopped?: { reason?: string } } | null | undefined): boolean;
export function automaticGrant(input: { kept?: SharedFolder[]; home?: SharedFolder | null; screen?: boolean; projects?: SharedFolder[] }): AutomaticGrant;
export function lendsAsWanted(record: unknown, wanted: AutomaticGrant): boolean;
export function isHomeFolder(target: string): Promise<boolean>;
export function existingFolders<T>(folders: unknown[], validate: (folders: unknown[]) => Promise<T[]>): Promise<T[]>;
export function validateSharedFolders(folders: unknown, options?: { homeEdits?: boolean }): Promise<SharedFolder[]>;
export function validSharedOperation(operation: unknown, computerId: string): boolean;
export function createComputerSharing(options: {
  file: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  environments: () => Workspace[];
  enabled?: () => Promise<boolean>;
  protectedPaths?: string[];
  /** The desktop's cua connection, or why it did not start (`reason` stays on this computer). */
  cuaConnection: () => Promise<{ mcpCommand: string; mcpArgs: string[]; mcpEnv?: Record<string, string> } | { mode: "unavailable"; reason: string } | null>;
  hostControl?: (id: string, signal: AbortSignal) => Promise<{ renew(): Promise<unknown>; release(): Promise<unknown> }>;
  /** The OS reports the screen locked: a screen action is refused with the fix instead of failing in the driver. */
  screenLocked?: () => boolean;
  /** Seconds since the person last touched this computer, or null when the system cannot tell: while they are using it,
   * a lent screen call that would take their mouse, keyboard or front window waits, and background calls run. */
  idleSeconds?: () => number | null;
  /** Home directory whose credential and autostart locations are protected. */
  home?: string;
  activityFile?: string;
  /** The home's sign-in as `env`'s lending checks it (lending-target.mjs). */
  cloud?: (env?: Workspace | null) => { status: string; accountId: string | null; origin: string | null } | null;
  now?: () => number;
  /** `busy.action` is "internet" while the home's browsing goes through this computer. */
  onChange?: (summary: LendingSummary) => void;
  /** The device link's sign-in for the home, as the poll's fetch carries it (its session cookie). */
  linkHeaders?: (env: Workspace) => Record<string, string> | Promise<Record<string, string>>;
  WebSocket?: typeof globalThis.WebSocket;
  /** The Chrome door's options, for tests: an object with `open` stands in for the door. */
  chrome?: Parameters<typeof import("./device-chrome.mjs").createChromeDoor>[0];
  /** This computer's own check on each connection, for tests: how it looks names up and connects. */
  egress?: Omit<NonNullable<Parameters<typeof import("./device-egress.mjs").createDeviceEgress>[0]>, "seenAs">;
  /** The saved server that is the person's bots' home: the move's project folders are lent to it. */
  homeServer?: () => Workspace | null;
  /** The saved servers lent this computer by themselves: the person's bots' home. */
  ownClouds?: () => Workspace[];
  /** Computer control's state; its `lent` says whether apps and screen are lent: computer control works, or only macOS's
   * permissions are missing. */
  screen?: () => boolean | ScreenStatus | Promise<boolean | ScreenStatus>;
  /** A home bot needs apps and screen while computer control isn't running: asks macOS for what it lacks. */
  askForScreen?: (connection: unknown) => void;
  /** This app's own prompt for an ask: "turn-on", "not-now", or null when it didn't show or `signal` closed it. */
  prompt?: (env: Workspace, ask: ComputerAsk, signal: AbortSignal) => Promise<"turn-on" | "not-now" | null>;
  /** Starts computer control again; its state after. */
  startScreen?: () => Promise<ScreenStatus | null>;
  /** Turns on running commands once the person confirms it on this computer; true when they did. */
  confirmTerminal?: () => Promise<boolean>;
  log?: (line: string) => void;
}): {
  state(id: string): SharingState;
  activity(id?: string, limit?: number): LendingActivityEntry[];
  identity(env: Workspace): Promise<Identity>;
  observe(env: Workspace): Promise<Identity | null>;
  decline(env: Workspace, identity: Identity): void;
  save(env: Workspace, input: Pick<SharingState, "folders" | "terminal" | "computer">, identity: Identity): Promise<SharingState>;
  revoke(env: Workspace): SharingState;
  forget(env: Workspace): void;
  /** The move's project folders, lent to the home with editing; rejects while that can't happen yet. */
  lendProjects(paths: string[], place?: { id: string; origin: string; name: string } | null): Promise<void>;
  paused(): boolean;
  /** The home stops using this computer, across restarts too, until resume(). */
  pause(): void;
  resume(): Promise<void> | undefined;
  screenChanged(): Promise<void>;
  cloudChanged(): void;
  start(options?: { maintainer?: boolean }): void;
  close(): void;
};
export function sharedCuaConnection(connection: unknown): { mcpCommand: string; mcpArgs: string[]; mcpEnv?: Record<string, string> } | null;
