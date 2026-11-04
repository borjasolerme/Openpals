import { describe, expect, it } from "vitest";

import { knownTimeZone } from "./time-zone.ts";

describe("the zone this server tells time in", () => {
  it("takes only IANA zone names the runtime knows", () => {
    for (const zone of ["UTC", "Asia/Kolkata", "Europe/London", "America/Argentina/Buenos_Aires", "Etc/GMT+5"]) expect(knownTimeZone(zone), zone).toBe(zone);
    for (const bad of ["+05:30", "IST", "Mars/Olympus_Mons", "../etc/passwd", "Asia/Kolkata\n", "", 330, null, "A".repeat(70)]) expect(knownTimeZone(bad), String(bad)).toBeNull();
  });
});
