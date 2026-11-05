import { useEffect, useState } from "react";
import { currentPlace } from "./place";

/**
 * Whether the desktop app's window shows the paired server rather than this computer's own. The preload decides it from
 * the page's own origin against this app's server, the same rule that decides which bridge a page gets, so it holds
 * before anything loads. False in a browser, on this computer's page and in older desktop builds.
 */
export function desktopShowsOtherServer(): boolean {
  return typeof window !== "undefined" && window.ogb?.app?.ownPage === false;
}

/** That server's name as the app saved it, or its address until the app answers; null when there is none. */
export function useOtherServerName(enabled = true): string | null {
  const other = enabled && desktopShowsOtherServer();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!other) return;
    let alive = true;
    void currentPlace()
      .then((place) => { if (alive && place?.kind === "server" && place.label.trim()) setName(place.label.trim()); })
      .catch(() => {});
    return () => { alive = false; };
  }, [other]);
  return other ? (name ?? window.location.host) : null;
}
