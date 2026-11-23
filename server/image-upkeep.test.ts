import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const DATA_ROOT = mkdtempSync(join(tmpdir(), "omb-image-upkeep-"));
process.env.OMB_DATA_DIR = join(DATA_ROOT, "data");
const { ATTACHMENTS_DIR, ensureAttachmentsDir } = await import("./attachments.ts");
const { sweepOldImages } = await import("./image-upkeep.ts");
afterAll(() => rmSync(DATA_ROOT, { recursive: true, force: true }));

const DAY = 86_400_000;
const NOW = Date.now();
function file(path: string, ageDays: number, bytes = "x"): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, bytes);
  const at = (NOW - ageDays * DAY) / 1000;
  utimesSync(path, at, at);
  return path;
}

describe("sweepOldImages", () => {
  it("removes only old copies of tools' screenshots, in the chat's store and next to the engine's sessions", () => {
    ensureAttachmentsDir();
    const a = (name: string, age: number) => file(join(ATTACHMENTS_DIR, name), age);
    const named = a("tool-1111.jpg", 20);
    const namedNew = a("tool-2222.jpg", 3);
    const legacy = a("aaaa.png", 20);
    const legacyNew = a("bbbb.png", 3);
    const alsoTheirs = a("cccc.png", 20);
    const theirs = a("dddd.png", 20);
    const avatar = a("eeee.png", 20);
    const engine = join(DATA_ROOT, "data", "providers", "claude-1");
    const blob = file(join(engine, "projects", "-proj", "session-1", "tool-results", "mcp-computer-blob-1.png"), 20);
    const blobNew = file(join(engine, "projects", "-proj", "session-1", "tool-results", "mcp-computer-blob-2.png"), 3);
    const text = file(join(engine, "projects", "-proj", "session-1", "tool-results", "big-output.txt"), 20);
    const transcript = file(join(engine, "projects", "-proj", "session-1.jsonl"), 20);

    const result = sweepOldImages({
      engineFolders: () => [engine],
      attachmentUses: () => ({ tool: new Set(["aaaa.png", "bbbb.png", "cccc.png", "eeee.png"]), other: new Set(["cccc.png", "dddd.png"]) }),
      kept: () => new Set(["eeee.png"]),
      now: () => NOW,
    });

    expect(result.removed).toBe(3);
    for (const gone of [named, legacy, blob]) expect(existsSync(gone), gone).toBe(false);
    for (const stays of [namedNew, legacyNew, alsoTheirs, theirs, avatar, blobNew, text, transcript]) expect(existsSync(stays), stays).toBe(true);
  });

  it("leaves screenshots from before the naming alone while it cannot tell what else still needs them", () => {
    ensureAttachmentsDir();
    const legacy = file(join(ATTACHMENTS_DIR, "ffff.png"), 30);
    sweepOldImages({ engineFolders: () => [], attachmentUses: () => ({ tool: new Set(["ffff.png"]), other: new Set() }), kept: () => null, now: () => NOW });
    expect(existsSync(legacy)).toBe(true);
  });
});
