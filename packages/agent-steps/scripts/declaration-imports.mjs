// tsc rewrites "./x.ts" to "./x.js" in the JavaScript it emits but not in the declarations; TypeScript before 5.0 and
// some tools cannot follow a .ts path from a .d.ts, so the declarations get the .js paths the JavaScript has.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RELATIVE_TS = /(from\s+["']|import\(\s*["'])(\.{1,2}\/[^"']+?)\.ts(["'])/gu;

export function rewriteDeclaration(text) {
  return text.replace(RELATIVE_TS, "$1$2.js$3");
}

function walk(folder) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".d.ts")) writeFileSync(path, rewriteDeclaration(readFileSync(path, "utf8")));
  }
}

if (process.argv[2]) walk(process.argv[2]);
