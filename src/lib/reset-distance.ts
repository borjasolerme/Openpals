/** How long until a usage window resets ("2d 4h", "35m"), or null when it is unknown or already past. */
export function formatResetDistance(resetsAt: string | number | null | undefined, now: number): string | null {
  if (resetsAt == null) return null;
  const at = typeof resetsAt === "number" ? resetsAt : Date.parse(resetsAt);
  if (!Number.isFinite(at) || at <= now) return null;
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes < 1) return "less than a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}
