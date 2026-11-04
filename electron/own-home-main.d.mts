/** A server of the person's own as their bots' home, chosen once. */
export interface OwnHomeChoice { v: 1; id: string; origin: string; environmentId: string; name: string; at: number }
/** A saved place, as main keeps it (environments.cjs). */
export interface SavedPlace { id: string; kind: string; name: string; origin?: string }
type Answer = { ok: boolean; status: number; body: any };

export declare const OWNER_KNOWN_MS: number;
export function freezeAnswer(got: Answer): { frozen: true } | { busy: string; what?: string };
export declare const OWNER_RETRY_MS: number;
export function parseChoice(value: unknown): OwnHomeChoice | null;
export function handSaved(entry: unknown): entry is SavedPlace & { kind: "remote"; origin: string };
export function serverRequests(place: { origin: string }, fetchImpl: typeof fetch): {
  request(method: string, route: string, init?: RequestInit): Promise<Response>;
  call(method: string, route: string, body?: unknown): Promise<Answer>;
  /** The server's word on this window's sign-in there. */
  who(): Promise<{ signedIn: boolean; own: boolean; environmentId: string | null; takesMove: boolean; status: number }>;
};
export function openServerSession(chosen: OwnHomeChoice, fetchImpl: typeof fetch): Promise<{
  call(method: string, route: string, body?: unknown): Promise<Answer>;
  upload(route: string, bytes: Uint8Array, type: string): Promise<Answer>;
  fetch(route: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}>;

export function installOwnHome(deps: {
  ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void };
  /** The asking page is this computer's own. */
  page(event: unknown): boolean;
  /** This computer's server's process, whose private port hands a moving secret to main alone. */
  server(): { postMessage(message: unknown): void } | null | undefined;
  /** The window whose page shows the move's line and whose typing the move waits out. */
  window(): { isDestroyed(): boolean; webContents: { send(channel: string, value: unknown): void; on?(event: string, listener: () => void): void; mainFrame: { url: string } } } | null;
  localOrigin(): string;
  /** This computer's server, as its owner. */
  localRequest(route: string, init?: RequestInit): Promise<Response>;
  /** This window's own requests, with its sign-ins. */
  fetch: typeof fetch;
  environments(): SavedPlace[];
  journal: { read(): unknown; write(value: unknown): void };
  choice: { read(): unknown; write(value: unknown): void };
  sendState: { read(): unknown; write(value: unknown): void };
  lend?(projects: string[], place: SavedPlace | null): Promise<unknown>;
  phone?: { paired(): boolean; stop(): Promise<void>; start(): Promise<void> };
  openHome?(place: SavedPlace): void;
  version?: string;
  onChange?(): void;
  now?(): number;
  log?(line: string): void;
}): {
  kick(): Promise<void>;
  away(): boolean;
  active(): boolean;
  origin(): string | null;
  home(): { id: string; origin: string; environmentId: string; name: string } | null;
  /** A server connected by hand whose fresh word is that it is this person's alone. */
  owns(place: unknown): boolean;
  offers(place: unknown): boolean;
  refresh(): void;
  start(id: string): Promise<{ started: true }>;
  close(): void;
  /** A handoff answer from this computer's server's private port. */
  receive(proc: unknown, message: unknown): boolean;
};
