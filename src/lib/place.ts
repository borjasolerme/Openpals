type PlaceBridge = NonNullable<NonNullable<Window["ogb"]>["place"]>;

export type BotsPlace = Awaited<ReturnType<PlaceBridge["current"]>>;

const bridge = (): PlaceBridge | undefined => (typeof window === "undefined" ? undefined : window.ogb?.place);

export function placeAvailable(): boolean {
  return Boolean(bridge());
}

/** Where the bots live; null in a browser, where the page itself is the place. */
export function currentPlace(): Promise<BotsPlace | null> {
  return bridge()?.current() ?? Promise.resolve(null);
}

export function connectServer(link: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return bridge()?.connect(link) ?? Promise.resolve({ ok: false, error: "desktop-only" });
}

export function disconnectServer(): Promise<void> {
  return bridge()?.disconnect() ?? Promise.resolve();
}

export function onPlaceChanged(callback: (place: BotsPlace) => void): () => void {
  return bridge()?.onChanged(callback) ?? (() => {});
}
