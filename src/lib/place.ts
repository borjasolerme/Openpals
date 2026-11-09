import { useEffect, useState } from "react";

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

/** Where the bots live now, kept current; null in a browser and until the desktop app answers. */
export function useBotsPlace(): BotsPlace | null {
  const [place, setPlace] = useState<BotsPlace | null>(null);
  useEffect(() => {
    let alive = true;
    void currentPlace().then((next) => { if (alive) setPlace(next); }).catch(() => {});
    const stop = onPlaceChanged((next) => { if (alive) setPlace(next); });
    return () => { alive = false; stop(); };
  }, []);
  return place;
}

/** The name this computer goes by, as its own server reports it ("Borja's MacBook Pro"), without the ".local" macOS adds;
 * null until it answers, and on another page (`enabled` false), whose server is not this computer. */
export function useThisComputerName(enabled: boolean): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetch("/.well-known/openmausbot/environment", { signal: AbortSignal.timeout(5_000) })
      .then((response) => (response.ok ? response.json() : null))
      .then((environment: { label?: unknown } | null) => {
        const label = typeof environment?.label === "string" ? environment.label.trim().replace(/\.local$/i, "") : "";
        if (alive && label) setName(label);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return name;
}

/** A one-time pairing link as the installer prints it: https://host/pair#code=…, the code in the hash only. */
export function isServerPairingLink(input: string): boolean {
  const link = input.trim();
  if (!/^https:\/\//i.test(link) || /[\s\\]/.test(link)) return false;
  try {
    const url = new URL(link);
    const code = /(?:^|[#&])code=([^&]+)/.exec(url.hash)?.[1];
    return url.protocol === "https:" && !url.username && !url.password && !url.search
      && (url.pathname === "/pair" || url.pathname === "/pair/")
      && Boolean(code && decodeURIComponent(code).trim());
  } catch {
    return false;
  }
}
