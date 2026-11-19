import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestKey, type Recipe } from "agent-steps";
import { BotRecipes, RECIPES_FOLDER } from "./recipes.ts";

const recipe = (id: string, name: string): Recipe => ({
  version: 2, id, name, key: requestKey(name), request: name, revision: 1, inputs: [], checks: [], createdAt: 1_000, updatedAt: 1_000, lastUsedAt: 1_000,
  steps: [{ driver: "cua", tool: "launch_app", args: { name: "Notes" } }],
});

describe("BotRecipes", () => {
  let dir: string;
  let recipes: BotRecipes;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "saved-steps-recipes-"));
    recipes = new BotRecipes({ folder: (botId) => join(dir, botId), now: () => 5_000 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps each bot's recipes in a folder of its own", () => {
    recipes.save("b1", recipe("r1", "Open Notes"));
    expect(readdirSync(join(dir, "b1", RECIPES_FOLDER))).toEqual(["r1.json"]);
    expect(recipes.find("b1", "open notes")?.id).toBe("r1");
    expect(recipes.find("b2", "open notes")).toBeUndefined();
    recipes.touch("b1", "r1");
    expect(recipes.find("b1", "open notes")?.lastUsedAt).toBe(5_000);
    expect(recipes.forget("b1", "r1")).toBe(true);
    expect(recipes.forget("b1", "r1")).toBe(false);
  });

  it("holds only the person's own words: a recipe typing other words is never kept", () => {
    const typed: Recipe = { ...recipe("r2", "search for cats"), steps: [{ driver: "agent-browser", tool: "fill", args: { text: "dogs" }, target: { role: "searchbox", name: "Search" } }] };
    expect(() => recipes.save("b1", typed)).toThrow(/policy/);
  });

  it.each(["", ".", "..", "a/b", "a\\b"])("refuses the bot id %j", (botId) => {
    recipes.save(botId, recipe("r1", "open notes"));
    expect(recipes.find(botId, "open notes")).toBeUndefined();
    expect(recipes.forget(botId, "r1")).toBe(false);
    expect(existsSync(join(dir, RECIPES_FOLDER))).toBe(false);
  });
});
