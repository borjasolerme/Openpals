// How many threads one bot runs at once.
import { totalmem } from "node:os";

export const MAX_CONCURRENT_BOT_THREADS = 16;
const DEFAULT_THREADS_FLOOR = 3, BYTES_PER_DEFAULT_THREAD = 2 * 1024 ** 3;

type SavedThreads = { threads?: { maxConcurrentPerBot?: number } };

/** What the machine holds: a thread for every 2 GB of memory, between 3 and the ceiling. */
export function defaultBotThreads(totalBytes: number = totalmem()): number {
  return Math.min(MAX_CONCURRENT_BOT_THREADS, Math.max(DEFAULT_THREADS_FLOOR, Math.round(totalBytes / BYTES_PER_DEFAULT_THREAD)));
}

/** A saved number wins over what the machine holds. */
export function maxConcurrentBotThreads(cfg: SavedThreads, totalBytes: number = totalmem()): number {
  return cfg.threads?.maxConcurrentPerBot ?? defaultBotThreads(totalBytes);
}

export function botThreadLimitText(cfg: SavedThreads, totalBytes: number = totalmem()): string {
  return `this bot has reached its limit of ${maxConcurrentBotThreads(cfg, totalBytes)} parallel threads — wait for one to finish`;
}
