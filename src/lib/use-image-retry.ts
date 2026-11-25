import { useEffect, useState } from "react";

/** How long a picture may load before it is asked for again, how many quiet tries it gets, and the pause after a failed one. */
export const IMAGE_STALL_MS = 12_000;
export const IMAGE_AUTO_TRIES = 3;
const IMAGE_RETRY_DELAY_MS = 1_500;

/** A request a proxy holds up never ends on its own, so a picture still loading after a while is asked for again, and a
 * failed one gets a few quiet tries before it says it is unavailable. `attempt` keys the <img>, so a new one asks again. */
export function useImageRetry(loading: boolean, autoTries = IMAGE_AUTO_TRIES) {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!loading || attempt >= autoTries) return;
    const timer = setTimeout(() => setAttempt((value) => value + 1), IMAGE_STALL_MS);
    return () => clearTimeout(timer);
  }, [loading, attempt, autoTries]);
  return {
    attempt,
    /** After an error: true when another quiet try is on its way, false when it is time to say it failed. */
    retryQuietly(): boolean {
      if (attempt >= autoTries) return false;
      setTimeout(() => setAttempt((value) => value + 1), IMAGE_RETRY_DELAY_MS * (attempt + 1));
      return true;
    },
    /** The person's Retry. */
    retryNow(): void {
      setAttempt((value) => value + 1);
    },
  };
}
