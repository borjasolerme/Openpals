import type { PlaceColor, PlaceSwatch } from "../../electron/place-look.mjs";
import type { LocaleKey } from "@/locales";

/** A place's colour names, as main saves them (environments.cjs ENTRY_COLORS); each skin tunes its own tone of each. */
export const PLACE_COLORS = ["blue", "teal", "purple", "orange", "red", "yellow"] as const satisfies readonly PlaceColor[];

export function placeColor(value: unknown): PlaceColor | null {
  return PLACE_COLORS.includes(value as PlaceColor) ? value as PlaceColor : null;
}

/** The skin's tone for a saved colour; the fallback for none is the app's quiet control tone. */
export function placeColorFill(value: unknown): string {
  const color = placeColor(value);
  return color ? `var(--identity-${color})` : "var(--color-control)";
}

/** The colour each swatch is drawn in here (electron/place-look.mjs SWATCH_COLORS); slate is the plain one. */
const SWATCH_COLOR = { blue: "blue", green: "teal", amber: "yellow", rose: "red", violet: "purple", slate: null } as const satisfies Record<PlaceSwatch, PlaceColor | null>;

export function swatchFill(swatch: PlaceSwatch): string {
  const color = SWATCH_COLOR[swatch];
  return color ? placeColorFill(color) : "var(--color-raised)";
}

/** The swatches in the order they are offered, each with the name of the colour this app draws it in. */
export const SWATCH_LABEL = {
  blue: "placeColor.blue", green: "placeColor.teal", amber: "placeColor.yellow", rose: "placeColor.red", violet: "placeColor.purple", slate: "placeColor.slate",
} as const satisfies Record<PlaceSwatch, LocaleKey>;
export const SWATCH_ORDER = Object.keys(SWATCH_LABEL) as PlaceSwatch[];
