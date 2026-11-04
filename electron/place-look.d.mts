/** A saved colour's name; each skin tunes its own tone of each (environments.cjs ENTRY_COLORS). */
export type PlaceColor = "blue" | "teal" | "purple" | "orange" | "red" | "yellow";
/** A swatch a place's colour is picked from (slate: none). */
export type PlaceSwatch = "blue" | "green" | "amber" | "rose" | "violet" | "slate";
/** The colour of the place a page shows, as that page sees it. */
export interface PlaceLook {
  name: string;
  color: PlaceColor | null;
  /** The swatch it is offered as; null for none (or a colour no swatch has). */
  swatch: PlaceSwatch | null;
}
export type PlaceColorOutcome = "saved";
export declare const SWATCH_COLORS: Readonly<Record<PlaceSwatch, PlaceColor | null>>;
export declare const SWATCHES: readonly PlaceSwatch[];
export declare function swatchColor(swatch: unknown): PlaceColor | null;
export declare function swatchOf(color: unknown): PlaceSwatch | null;
export declare function placeLook(entry: any): PlaceLook | null;
export declare function railPaint(look: PlaceLook | null, color: unknown): { swatch: PlaceSwatch | null } | null;
export declare function installPlaceLook(deps: {
  ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void };
  guard: (handler: (...args: any[]) => unknown) => (...args: any[]) => unknown;
  place: () => any;
  save: (id: string, color: PlaceColor | null) => void;
  rail?: { owns(event: unknown): boolean; places(): Array<{ id: string; paint?: unknown }>; saved(id: string): any };
}): void;
