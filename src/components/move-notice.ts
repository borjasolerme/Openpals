import { useEffect, useState } from "react";
import type { CloudSendNotice, CloudSendPageBridge } from "../../electron/cloud-send.mjs";
import { moveQuietUntil } from "@/lib/cloud-send";

/** The move's notice from main, kept fresh: undefined until main first answers, null when it can't. */
export function useCloudSendNotice(bridge: CloudSendPageBridge | undefined) {
  const [notice, setNotice] = useState<CloudSendNotice | null | undefined>(undefined);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const unsubscribe = bridge.onNotice((next) => { if (alive) setNotice(next); });
    void bridge.notice().then((next) => { if (alive) setNotice(next ?? null); }).catch(() => { if (alive) setNotice((known) => known ?? null); });
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);
  return [notice, setNotice] as const;
}

/** The corner cards wait (moveQuietUntil): null until main first answers, then whether
 * they wait now. The time after the move is kept once its line is closed, and the page looks again when it is over. */
export function useMoveQuiet(now: () => number = Date.now): boolean | null {
  const bridge = !window.ogb?.remoteClient?.active ? window.ogb?.cloudSendPage : undefined;
  const [notice] = useCloudSendNotice(bridge);
  const [after, setAfter] = useState(0);
  const [, setLooked] = useState(0);
  const until = moveQuietUntil(notice?.move);
  useEffect(() => { if (Number.isFinite(until) && until > after) setAfter(until); }, [until, after]);
  const end = Math.max(after, until);
  useEffect(() => {
    if (!Number.isFinite(end) || end <= now()) return;
    const timer = setTimeout(() => setLooked((count) => count + 1), end - now());
    return () => clearTimeout(timer);
  }, [end]);
  if (bridge && notice === undefined) return null;
  return end > now();
}
