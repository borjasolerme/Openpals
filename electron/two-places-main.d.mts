import type { TwoPlaces } from "./two-places.mjs";

export function installTwoPlacesMain(deps: {
  ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void };
  /** This computer's own page only. */
  guard(channel: string, handler: (...args: any[]) => unknown): (...args: any[]) => unknown;
  localRequest(route: string, init?: RequestInit): Promise<Response>;
  fetch: typeof fetch;
  environments(): any[];
  ownHome: { owns(place: any): boolean; offers(place: any): boolean; start(id: string): Promise<unknown>; active(): boolean; away(): boolean; refresh(): void };
  dismissed: { read(): unknown; write(value: unknown): void };
  tell(): void;
  log?(line: string): void;
}): TwoPlaces & { close(): void };
