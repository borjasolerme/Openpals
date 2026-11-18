// Each bot's saved steps: a folder of recipes in the bot's own folder, strict policy (the person's own words only).
import { basename, join } from "node:path";
import { FileStore, type Recipe } from "../../packages/agent-steps/src/index.ts";

export const RECIPES_FOLDER = "saved-steps";

const safeBotId = (botId: string) => botId !== "" && botId !== "." && botId !== ".." && basename(botId) === botId && !/[\\/]/.test(botId);

export class BotRecipes {
  private readonly folder: (botId: string) => string;
  private readonly now: () => number;

  constructor(options: { folder: (botId: string) => string; now?: () => number }) {
    this.folder = options.folder;
    this.now = options.now ?? Date.now;
  }

  find(botId: string, key: string): Recipe | undefined {
    return this.store(botId)?.find(key);
  }

  save(botId: string, recipe: Recipe): void {
    this.store(botId)?.save(recipe);
  }

  touch(botId: string, recipeId: string): void {
    this.store(botId)?.touch(recipeId);
  }

  forget(botId: string, recipeId: string): boolean {
    return this.store(botId)?.forget(recipeId) ?? false;
  }

  private store(botId: string): FileStore | null {
    return safeBotId(botId) ? new FileStore({ folder: join(this.folder(botId), RECIPES_FOLDER), policy: "strict", now: this.now }) : null;
  }
}
