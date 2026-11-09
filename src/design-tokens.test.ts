// Components size, round, shade and colour themselves with the design tokens, never with one-off values. Each entry
// below is a file allowed a fixed number of them, with the reason; a count may only go down, and an entry whose file
// no longer needs it must go.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = dirname(fileURLToPath(import.meta.url));

const KINDS = {
  "text size": /\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/g,
  radius: /\brounded(?:-[a-z]{1,2})?-\[\d+(?:\.\d+)?px\]/g,
  "line height": /\bleading-\[[^\]]+\]/g,
  "letter-spacing": /\btracking-\[[^\]]+\]/g,
  shadow: /\bshadow-\[[^\]]+\]/g,
  "raw colour": /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g,
} as const;
type Kind = keyof typeof KINDS;

const BRAND = "a third party's own brand colours, drawn as its logo";
const ART = "colours of generated art, not of the interface";
const MATH = "colour arithmetic that derives tones from a bot's colour";
const QR = "a QR code must be dark on white for a camera to read it";

const ALLOWED: Record<string, Partial<Record<Kind, number>> & { why: string }> = {
  "components/widget/widget-style.ts": { "text size": 19, "line height": 9, "letter-spacing": 8, why: "the widget schema's own type scale, which bots author widgets against" },
  "components/PinnedCircles.tsx": { shadow: 4, why: "a drop target's edge, a hard 2px offset on the side the circle lands" },
  "components/ProviderIcons.tsx": { "raw colour": 16, why: BRAND },
  "components/XCard.tsx": { "raw colour": 2, why: BRAND },
  "components/PostizCard.tsx": { "raw colour": 2, why: BRAND },
  "components/HighLevelCard.tsx": { "raw colour": 2, why: BRAND },
  "lib/mascot.ts": { "raw colour": 17, why: ART },
  "components/CursorAvatar.tsx": { "raw colour": 15, why: ART },
  "components/Avatar.tsx": { "raw colour": 4, why: ART },
  "components/CarvedAvatar.tsx": { "raw colour": 2, why: ART },
  "lib/user-bubble-tone.ts": { "raw colour": 8, why: MATH },
  "lib/bot-button.ts": { "raw colour": 3, why: MATH },
  "lib/color-contrast.ts": { "raw colour": 2, why: MATH },
  "lib/brand.ts": { "raw colour": 2, why: MATH },
  "components/CallView.tsx": { "raw colour": 1, why: MATH },
  "components/data/SqlEditor.tsx": { "raw colour": 6, why: "CodeMirror's syntax palette, one tone per light and dark scheme" },
  "components/ServerPairingCard.tsx": { "raw colour": 2, why: QR },
  "components/PhoneSetupFlow.tsx": { "raw colour": 2, why: QR },
  "components/app/app-host-context.ts": { "raw colour": 3, why: "the MCP Apps host theme variables an embedded app reads, fixed by that spec" },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function counts(text: string): Partial<Record<Kind, number>> {
  return Object.fromEntries((Object.keys(KINDS) as Kind[])
    .map((kind) => [kind, text.match(KINDS[kind])?.length ?? 0])
    .filter(([, count]) => count)) as Partial<Record<Kind, number>>;
}

describe("design tokens", () => {
  it("keeps one-off sizes, radii, line heights, letter-spacing, shadows and raw colours out of components", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const path of sourceFiles(srcRoot)) {
      const file = relative(srcRoot, path).replaceAll("\\", "/");
      const found = counts(readFileSync(path, "utf8"));
      const allowed = ALLOWED[file];
      if (allowed) seen.add(file);
      for (const kind of Object.keys(found) as Kind[]) {
        const limit = allowed?.[kind] ?? 0;
        if (found[kind]! > limit) problems.push(`${file}: ${found[kind]} arbitrary ${kind} value(s), ${limit} allowed; use the token scale in styles.css`);
      }
      for (const kind of Object.keys(allowed ?? {}).filter((key) => key !== "why") as Kind[]) {
        if (!found[kind]) problems.push(`${file}: no ${kind} value left; drop it from ALLOWED`);
      }
    }
    for (const file of Object.keys(ALLOWED)) if (!seen.has(file)) problems.push(`${file} is gone; drop it from ALLOWED`);
    expect(problems).toEqual([]);
  });

  it("sizes text in styles.css with the type tokens, and inline sizes in whole pixels", () => {
    const css = readFileSync(join(srcRoot, "styles.css"), "utf8");
    // Safari zooms a field under 16px on focus; that one rule names the size the platform requires.
    expect(css.match(/font-size:\s*\d+(?:\.\d+)?px/g)).toEqual(["font-size: 16px"]);
    const fractional = sourceFiles(srcRoot).flatMap((path) =>
      (readFileSync(path, "utf8").match(/fontSize:\s*\d+\.\d+(?![\d.])/g) ?? []).map((size) => `${relative(srcRoot, path)}: ${size}`));
    expect(fractional).toEqual([]);
  });

  it("finds each kind it guards", () => {
    expect(counts('cn("text-[13px] rounded-[10px] leading-[18px] tracking-[0.08em] shadow-[0_1px_2px] bg-[#fff]")'))
      .toEqual({ "text size": 1, radius: 1, "line height": 1, "letter-spacing": 1, shadow: 1, "raw colour": 1 });
    expect(counts('cn("text-base rounded-lg leading-5 tracking-caps shadow-popup bg-fill text-[0.88em]")')).toEqual({});
  });
});
