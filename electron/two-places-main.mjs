// Main's side of the two-places suggestion (two-places.mjs): the person's own servers besides this computer, each read and
// told over this window's own sign-in there, and the one tap that starts the move to one. A server is a place while it
// says it is theirs alone (and one to go to while nothing moves yet); never a server others sign in to.
import { handSaved, serverRequests } from "./own-home-main.mjs";
import { createTwoPlaces, installTwoPlaces } from "./two-places.mjs";

/** How often main looks whether the places changed (a server said it is the person's own). */
const WATCH_MS = 60_000;
const ROUTE = "/api/places/elsewhere";

async function json(response) {
  if (!response.ok) { await response.body?.cancel(); return null; }
  try { return await response.json(); } catch { return null; }
}
async function sent(response, what) {
  await response.body?.cancel();
  if (!response.ok) throw Object.assign(new Error(`${what} answered ${response.status}`), { status: response.status });
}

/**
 * @param {{
 *   ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void },
 *   guard(channel: string, handler: (...args: any[]) => unknown): (...args: any[]) => unknown,
 *   localRequest(route: string, init?: RequestInit): Promise<Response>,
 *   fetch: typeof fetch,
 *   environments(): any[],
 *   ownHome: { owns(place: any): boolean, offers(place: any): boolean, start(id: string): Promise<unknown>, active(): boolean, away(): boolean, refresh(): void },
 *   dismissed: { read(): unknown, write(value: unknown): void },
 *   tell(): void,
 *   log?(line: string): void,
 * }} deps `guard`: this computer's own page only. `tell()`: the suggestion changed, so this computer's page asks again.
 */
export function installTwoPlacesMain({ ipcMain, guard, localRequest, fetch: fetchImpl, environments, ownHome, dismissed, tell, log = () => {} }) {
  const put = (payload) => ({ method: "PUT", body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
  const places = () => environments().filter((entry) => handSaved(entry) && ownHome.owns(entry)).map((place) => {
    const server = serverRequests(place, fetchImpl);
    return { key: `server:${place.origin}`, name: place.name, kind: "server",
      read: async () => json(await server.request("GET", "/api/cloud-send?move=1", { signal: AbortSignal.timeout(10_000) })),
      tell: async (payload) => sent(await server.request("PUT", ROUTE, { ...put(payload), headers: { "content-type": "application/json" } }), place.name),
      ...(ownHome.offers(place) ? { bring: () => ownHome.start(place.id) } : {}) };
  });
  const settled = () => !ownHome.active();
  let label = null;
  const twoPlaces = createTwoPlaces({
    local: async () => (ownHome.away() ? null : json(await localRequest("/api/cloud-send?move=1", { signal: AbortSignal.timeout(10_000) }))),
    here: {
      name: async () => (label ??= (await json(await localRequest("/.well-known/openmausbot/environment", { signal: AbortSignal.timeout(10_000) })))?.label ?? null),
      tell: async (payload) => sent(await localRequest(ROUTE, { ...put(payload), headers: { "content-type": "application/json" } }), "This computer"),
    },
    places, settled, quiet: () => !settled() && !ownHome.away(), dismissed, onChange: tell, log });
  installTwoPlaces({ ipcMain, guard, twoPlaces });
  let watched = "";
  const watch = setInterval(() => {
    ownHome.refresh();
    const now = JSON.stringify([settled(), ownHome.away(), places().map((place) => [place.key, Boolean(place.bring)])]);
    if (now !== watched) { watched = now; void twoPlaces.refresh({ force: true }); } else void twoPlaces.refresh();
  }, WATCH_MS);
  watch.unref?.();
  return { ...twoPlaces, close: () => clearInterval(watch) };
}
