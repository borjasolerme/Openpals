// The colour of the place a page shows: drawn faintly at the top of its sidebar and on its circle in the rail, and
// changed from its own Settings. This app keeps the colour of This computer and of each server connected by hand. A page
// learns and changes only the colour of the place it is; the window's own rail changes the colour of any place it lists
// (a right-click on its circle).
import environments from "./environments.cjs";

/** The swatches a colour is picked from, and the saved colour each one is (slate: none). */
export const SWATCH_COLORS = Object.freeze({ blue: "blue", green: "teal", amber: "yellow", rose: "red", violet: "purple", slate: null });
export const SWATCHES = Object.freeze(Object.keys(SWATCH_COLORS));
export const swatchColor = swatch => (Object.hasOwn(SWATCH_COLORS, swatch) ? SWATCH_COLORS[swatch] : null);

/** The swatch a saved colour is offered as; null for none, or a colour no swatch has. */
export function swatchOf(color) {
  if (!environments.ENTRY_COLORS.includes(color)) return null;
  return SWATCHES.find(swatch => SWATCH_COLORS[swatch] === color) ?? null;
}

/** A place's name and colour. Null for no place. */
export function placeLook(entry) {
  if (!entry) return null;
  if (entry.kind !== "local" && (typeof entry.origin !== "string" || !entry.origin)) return null;
  const color = environments.ENTRY_COLORS.includes(entry.color) ? entry.color : null;
  return { name: entry.name, color, swatch: swatchOf(color) };
}

/** What the rail's circle says of a look: the swatch of the colour it shows. */
export const railPaint = (look, color) => (look ? { swatch: swatchOf(color) } : null);

/**
 * The page's own place's colour (`workspaces:look`) and its change (`workspaces:color`, a swatch or null for none),
 * each behind main's window guard. `place()`: the place on screen (This computer included), which the guard made sure
 * the asking page is; `save(id, color)`: this app's own record of that place. `rail`: the window's own rail, which
 * changes the colour of any place it lists (`workspaces:recolor`, its circle's id and a swatch): `owns(event)` its page
 * asks, `places()` railPlaces' list now, `saved(id)` that place (This computer's too).
 */
export function installPlaceLook({ ipcMain, guard, place, save, rail = null }) {
  const recolor = async (entry, swatch) => {
    if (!(swatch === null || SWATCHES.includes(swatch))) throw new Error("Choose one of the colors.");
    if (!placeLook(entry)) throw new Error("This place has no color to change.");
    save(entry.id, swatchColor(swatch));
  };
  ipcMain.handle("workspaces:look", guard(() => placeLook(place())));
  ipcMain.handle("workspaces:color", guard(async (_event, swatch) => {
    await recolor(place(), swatch);
    return { outcome: "saved", look: placeLook(place()) };
  }));
  if (rail) ipcMain.handle("workspaces:recolor", (event, id, swatch) => {
    if (!rail.owns(event)) throw new Error("workspaces:recolor is only available to the window's rail");
    const entry = rail.places().some(listed => listed.id === id && listed.paint) ? rail.saved(id) : null;
    if (!entry) return Promise.reject(new Error("That place isn't here any more."));
    return recolor(entry, swatch).then(() => ({ outcome: "saved", look: placeLook(rail.saved(id)) }));
  });
}
