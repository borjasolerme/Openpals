/** The page is out of sight: a background tab, a minimized or hidden window. */
export function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Resolves once the page shows again (at once when it isn't hidden); rejects if `signal` aborts first. */
export function pageShown(signal?: AbortSignal): Promise<void> {
  if (!pageHidden()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { document.removeEventListener("visibilitychange", check); signal?.removeEventListener("abort", abort); };
    const check = () => { if (!pageHidden()) { done(); resolve(); } };
    const abort = () => { done(); reject(signal?.reason ?? new DOMException("The request was aborted.", "AbortError")); };
    if (signal?.aborted) { abort(); return; }
    document.addEventListener("visibilitychange", check);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
