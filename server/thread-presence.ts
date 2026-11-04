// Which conversations a person has in front of them: asked in from any channel, or opened or read in the app.

const seenListeners = new Set<(threadId: string) => void>();

/** The last time a person asked something in a thread, from any channel; a turn nobody asked for clears it. */
export const personAsks = new Map<string, number>();

/** A person had this thread in front of them: opened or read it in the app, or asked in it. Listeners hear an open or a
 * read, not an ask: an ask starts a turn of its own. */
export function sawThread(threadId: string): void {
  for (const listener of seenListeners) {
    try { listener(threadId); } catch (error) { console.warn(`thread presence: ${(error as Error).message}`); }
  }
}

/** Hears every thread a person opens, reads or is active in; returns the unsubscribe. */
export function onThreadSeen(listener: (threadId: string) => void): () => void {
  seenListeners.add(listener);
  return () => seenListeners.delete(listener);
}

export function forgetPresence(): void {
  personAsks.clear();
}
