// Old screenshots go by themselves, so a bot that works on a screen all day never fills the disk. Only copies of tools'
// screenshots are removed: never a file the person sent, a picture a bot made for them, an avatar or a routine's file.
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ATTACHMENTS_DIR, expireAttachments, invalidateAttachmentAccounting } from "./attachments.ts";
import { TOOL_SCREENSHOT_MAX_AGE_MS, TOOL_SCREENSHOT_PREFIX } from "./tool-screenshots.ts";

const IMAGE = /\.(?:png|jpe?g|webp|gif)$/iu;

export interface ImageUpkeepDeps {
  /** Every Claude engine's config folder under the data folder: its `projects` holds the CLI's own copies. */
  engineFolders(): string[];
  /** Stored files shown as a tool's screenshot, and every other use. */
  attachmentUses(): { tool: Set<string>; other: Set<string> };
  /** Files something else still needs (avatars, routines' files, a turn in progress), or null while that is unknown. */
  kept(): ReadonlySet<string> | null;
  now?(): number;
  maxAgeMs?: number;
}

export interface ImageUpkeepResult { removed: number; freedBytes: number }

function removeIfOld(path: string, cutoff: number, result: ImageUpkeepResult): void {
  try {
    const { mtimeMs, size } = statSync(path);
    if (mtimeMs >= cutoff) return;
    unlinkSync(path);
    result.removed += 1;
    result.freedBytes += size;
  } catch { /* gone already, or busy: the next sweep tries again */ }
}

/** The Claude CLI keeps each tool's screenshot again as a file next to its session (projects/<project>/<session>/tool-results). */
function sweepEngineCopies(folder: string, cutoff: number, result: ImageUpkeepResult): void {
  const walk = (dir: string, depth: number): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) walk(path, depth + 1);
      else if (entry.isFile() && depth === 3 && IMAGE.test(entry.name) && dir.endsWith("tool-results")) removeIfOld(path, cutoff, result);
    }
  };
  walk(join(folder, "projects"), 0);
}

export function sweepOldImages(deps: ImageUpkeepDeps): ImageUpkeepResult {
  const now = deps.now?.() ?? Date.now();
  const maxAge = deps.maxAgeMs ?? TOOL_SCREENSHOT_MAX_AGE_MS;
  const cutoff = now - maxAge;
  const result = expireAttachments(TOOL_SCREENSHOT_PREFIX, maxAge, now);
  // Screenshots stored before they were named as such: removed when every chat that shows them shows them as a tool's.
  const kept = deps.kept();
  if (kept) {
    const { tool, other } = deps.attachmentUses();
    const before = result.removed;
    for (const name of tool) {
      if (other.has(name) || kept.has(name) || name.startsWith(TOOL_SCREENSHOT_PREFIX) || !IMAGE.test(name)) continue;
      removeIfOld(join(ATTACHMENTS_DIR, name), cutoff, result);
    }
    if (result.removed > before) invalidateAttachmentAccounting();
  }
  for (const folder of deps.engineFolders()) sweepEngineCopies(folder, cutoff, result);
  return result;
}
