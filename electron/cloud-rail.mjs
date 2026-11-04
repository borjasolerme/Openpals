// The rail of places at the left of the window (the renderer's PlacesRail, drawn by the window's own chrome rail page,
// chrome-rail.mjs) and its ＋: main builds the list, says who may read it, and does what a circle or ＋ asks through
// main's own switch and dialogs.
//
// Security: the list carries names, colours and states, never an address, and goes only to the rail's own page, this
// app's. No place's page reads it, not even this computer's: a server the person connected by hand runs a page anyone
// may have written, and would learn the names of the person's other places. A page learns only that the rail stands
// beside it. A circle names a saved place by its id; main opens or removes only an id it listed itself.
import environments from "./environments.cjs";
import { placeLook, railPaint } from "./place-look.mjs";

export const RAIL_MIN_PLACES = 2;

/** One saved server as a circle. `offers(entry)`: its menu offers Make … my home (own-home-main.mjs). */
function circle(entry, { activeId, offers }) {
  const color = environments.ENTRY_COLORS.includes(entry.color) ? entry.color : null;
  const paint = railPaint(placeLook(entry), color);
  return { id: entry.id, name: entry.name, color, kind: "server", opens: true, ...(paint ? { paint } : {}), ...(entry.id === activeId ? { active: true } : {}),
    removable: true, forget: true, ...(offers(entry) ? { makeHome: true } : {}) };
}

/**
 * The circles, in the Server menu's order: This computer while it is a place (`home` null: no server of the person's own
 * is their bots' home yet), then the servers saved by hand. Fewer than RAIL_MIN_PLACES places in all: no rail at all.
 * @param {{ saved: { environments: any[], activeId: string }, home?: string | null, offers?: (entry: any) => boolean }} input
 */
export function railPlaces({ saved, home = null, offers = () => false }) {
  const places = saved.environments.filter(entry => entry.kind !== "local" && entry.origin).map(entry => circle(entry, { activeId: saved.activeId, offers }));
  const computer = environments.savedPlace(saved, environments.LOCAL_ID), color = computer.color ?? null;
  const all = home ? places : [{ id: computer.id, name: computer.name, color, kind: "computer", opens: true, paint: railPaint(placeLook(computer), color),
    ...(saved.activeId === environments.LOCAL_ID ? { active: true } : {}) }, ...places];
  return all.length < RAIL_MIN_PLACES ? [] : all;
}

const plain = value => (typeof value === "string" ? value : "");
const CHOICES = Object.freeze(["link", "address"]);

/**
 * The rail's and ＋'s channels, each behind main's guard (`guard`: the window's page, or the rail's own). Only the rail's
 * page (`lists`) reads the list and opens or adds a place. Any other page learns only whether the rail stands beside it
 * (`beside`). `places()` is railPlaces' list now; `open(id)` main's own switch; `add` the ＋ sheet's fixed actions;
 * `targets()` the pages told when something changed; `makeHome(id)` starts the move to a server of the person's own
 * (own-home-main.mjs `start`); `forget(id)` forgets a server on this computer.
 */
export function installCloudRail({ ipcMain, guard, lists, beside = () => false, places, open, add, targets, makeHome, forget }) {
  let sent = "";
  const listed = (channel, handler) => ipcMain.handle(channel, guard((event, ...args) => {
    if (!lists(event)) throw new Error(`${channel} is only available in this app's window`);
    return handler(event, ...args);
  }));
  ipcMain.handle("workspaces:places", guard((event) => (lists(event) ? { places: places(), add: add.choices() }
    : { places: [], add: { link: false, address: false }, ...(beside() ? { beside: true } : {}) })));
  listed("workspaces:open", (_event, id) => {
    const place = places().find(entry => entry.id === plain(id) && entry.opens);
    if (!place) throw new Error("That place isn't here any more.");
    return open(place.id);
  });
  // Remove from list, from a circle's menu (the page asked the person first): a server is forgotten on this computer.
  listed("workspaces:remove", async (_event, id) => {
    const place = places().find(entry => entry.id === plain(id) && entry.removable);
    if (!place) throw new Error("That place isn't here any more.");
    return { outcome: (await forget(place.id)) === false ? "failed" : "removed" };
  });
  // Make … my home, from a circle's menu: only a server main listed with it, by main's own word for it.
  listed("workspaces:make-home", (_event, id) => {
    const place = places().find(entry => entry.id === plain(id) && entry.makeHome);
    if (!place) throw new Error("That server can't be your bots' home now.");
    return makeHome(place.id);
  });
  // A link pasted on ＋'s sheet goes to main's own Connect dialog, which checks it and names its host before connecting.
  listed("workspaces:add", (_event, choice, link) => {
    if (!CHOICES.includes(choice) || !add.choices()[choice]) throw new Error("That isn't something to add here.");
    const pasted = choice === "link" ? plain(link).trim().slice(0, 4096) : "";
    return pasted ? add.run(choice, pasted) : add.run(choice);
  });
  return {
    /** The places or the rail beside the page changed: the rail's page and the page beside it read them again (a signal
     * only, never the list). */
    changed() {
      const key = JSON.stringify([places(), add.choices(), beside()]);
      if (key === sent) return;
      sent = key;
      for (const target of targets()) if (target && !target.isDestroyed()) target.send("workspaces:changed");
    },
  };
}
