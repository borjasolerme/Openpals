// The zone this server tells time in: the computer's own clock (process.env.TZ when set).

/** An IANA Area/Location name (or UTC) the runtime knows, as a browser reports it; null for an offset, an abbreviation
 * such as "IST" (which ICU still takes) or anything else. */
export function knownTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 || (value !== "UTC" && !/^[A-Za-z][\w+-]*(\/[\w+-]+){1,2}$/.test(value))) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** The zone this process tells time in: TZ when it names one, else the computer's. */
export function currentTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  return knownTimeZone(env.TZ) ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
}
