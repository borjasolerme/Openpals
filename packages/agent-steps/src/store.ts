// A folder of recipes, one JSON file each. Every read checks the recipe again, so a file edited by hand into something
// unsafe is skipped, and recipes unused for long or beyond the limit are dropped.
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecipe } from "./recipe.ts";
import type { Policy, Recipe } from "./types.ts";

export const MAX_RECIPES = 200;
export const UNUSED_MS = 60 * 24 * 60 * 60 * 1000;

const FILE = /^([A-Za-z0-9_-]{1,128})\.json$/u;
const safeId = (id: string) => FILE.test(`${id}.json`);

export interface FileStoreOptions {
  folder: string;
  policy?: Policy;
  now?: () => number;
  maxRecipes?: number;
  unusedMs?: number;
}

export class FileStore {
  private readonly folder: string;
  private readonly policy: Policy;
  private readonly now: () => number;
  private readonly maxRecipes: number;
  private readonly unusedMs: number;

  constructor(options: FileStoreOptions) {
    this.folder = options.folder;
    this.policy = options.policy ?? "strict";
    this.now = options.now ?? Date.now;
    this.maxRecipes = options.maxRecipes ?? MAX_RECIPES;
    this.unusedMs = options.unusedMs ?? UNUSED_MS;
  }

  /** Every recipe still in use, most recently used first. */
  list(): Recipe[] {
    return this.all().slice(0, this.maxRecipes);
  }

  private all(): Recipe[] {
    let names: string[];
    try {
      names = readdirSync(this.folder);
    } catch {
      return [];
    }
    const cutoff = this.now() - this.unusedMs;
    const recipes: Recipe[] = [];
    for (const name of names) {
      const id = FILE.exec(name)?.[1];
      if (!id) continue;
      const recipe = this.readFile(id);
      if (recipe && recipe.id === id && recipe.lastUsedAt >= cutoff) recipes.push(recipe);
    }
    return recipes.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  find(key: string): Recipe | undefined {
    return this.list().find((recipe) => recipe.key === key);
  }

  get(id: string): Recipe | undefined {
    return this.list().find((recipe) => recipe.id === id);
  }

  /** Keeps the recipe, in place of any other with its key, and drops what falls past the limit. */
  save(recipe: Recipe): void {
    if (!safeId(recipe.id)) throw new Error("a recipe id holds letters, digits, - and _ only");
    if (!parseRecipe(recipe, this.policy)) throw new Error("this recipe does not meet the store's policy");
    const kept = this.all();
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    this.write(recipe);
    for (const old of kept) if (old.id !== recipe.id && old.key === recipe.key) this.remove(old.id);
    for (const extra of this.all().slice(this.maxRecipes)) if (extra.id !== recipe.id) this.remove(extra.id);
  }

  touch(id: string): void {
    const recipe = this.get(id);
    if (recipe) this.write({ ...recipe, lastUsedAt: this.now() });
  }

  forget(id: string): boolean {
    if (!this.get(id)) return false;
    this.remove(id);
    return true;
  }

  private readFile(id: string): Recipe | null {
    try {
      return parseRecipe(JSON.parse(readFileSync(join(this.folder, `${id}.json`), "utf8")), this.policy);
    } catch {
      return null;
    }
  }

  private write(recipe: Recipe): void {
    const path = join(this.folder, `${recipe.id}.json`);
    const temp = join(this.folder, `.${recipe.id}.${randomUUID()}.tmp`);
    writeFileSync(temp, `${JSON.stringify(recipe, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  }

  private remove(id: string): void {
    rmSync(join(this.folder, `${id}.json`), { force: true });
  }
}
