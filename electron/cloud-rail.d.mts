/** A circle of the rail: a place the window can show, by its saved id (`local` for this computer). Names, colours and
 * states only: never an address. */
export interface RailPlace {
  id: string;
  name: string;
  color: import("./place-look.mjs").PlaceColor | null;
  /** This computer, or a server the person connected by hand. */
  kind: "computer" | "server";
  opens: boolean;
  active?: true;
  /** Its colour is changed from the rail (a right-click on its circle): the swatch it shows. */
  paint?: { swatch: import("./place-look.mjs").PlaceSwatch | null };
  /** A server connected by hand: Remove from list forgets it on this computer (this app signs out of it there). */
  removable?: true;
  forget?: true;
  /** A server of the person's own, theirs alone by its own word, that this computer's bots may move to: its menu offers
   * Make … my home. */
  makeHome?: true;
}
/** ＋'s choices here: pasting a server's pairing link, and typing its address on this computer's Settings. */
export interface RailAddChoices { link: boolean; address: boolean }
/** `beside`: a place's page, which never reads the list, learns that the window's rail stands beside it. */
export interface RailState { places: RailPlace[]; add: RailAddChoices; beside?: true }
export declare const RAIL_MIN_PLACES: number;
export declare function railPlaces(input: { saved: { environments: any[]; activeId: string }; home?: string | null; offers?: (entry: any) => boolean }): RailPlace[];
