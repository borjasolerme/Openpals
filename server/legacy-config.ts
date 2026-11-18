import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { parseJson, type JsonObject } from "./schema.ts";

const jsonObjectSchema = z.record(z.string(), z.json());

/** Renames `features.skillRecorder` to `features.skillAuthoring`; drops `localVm`, the settings of the removed private desktops. */
function migratedConfig(config: JsonObject): { config: JsonObject; changes: string[] } {
  const next: JsonObject = { ...config };
  const changes: string[] = [];
  const features = jsonObjectSchema.safeParse(next.features);
  if (features.success && Object.hasOwn(features.data, "skillRecorder")) {
    const renamed: JsonObject = { ...features.data };
    if (!Object.hasOwn(renamed, "skillAuthoring")) renamed.skillAuthoring = renamed.skillRecorder === true;
    delete renamed.skillRecorder;
    next.features = renamed;
    changes.push(`features.skillRecorder renamed to features.skillAuthoring (${String(renamed.skillAuthoring)})`);
  }
  if (Object.hasOwn(next, "localVm")) {
    delete next.localVm;
    changes.push("localVm dropped");
  }
  return { config: next, changes };
}

/** Rewrites config.json in place when it still carries a retired setting. */
export function migrateLegacyConfig(dataDir: string): void {
  const p = join(dataDir, "config.json");
  try {
    if (!existsSync(p)) return;
    const disk = jsonObjectSchema.safeParse(parseJson(readFileSync(p, "utf8")));
    if (!disk.success) return;
    const { config, changes } = migratedConfig(disk.data);
    if (!changes.length) return;
    writeFileAtomic(p, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log(`[config] ${changes.join("; ")}`);
  } catch (error) {
    console.error(`[config] could not migrate config.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}
