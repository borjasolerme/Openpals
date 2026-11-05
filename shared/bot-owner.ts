export interface OwnedBot {
  section?: string;
  chiefOfStaff?: boolean;
}

export function chiefScope(bot: OwnedBot): string {
  return bot.section?.trim() || "";
}

export function chiefConflict(bots: readonly OwnedBot[]): boolean {
  const seen = new Set<string>();
  for (const bot of bots) {
    if (!bot.chiefOfStaff) continue;
    const scope = chiefScope(bot);
    if (seen.has(scope)) return true;
    seen.add(scope);
  }
  return false;
}

/** `chief` takes the crown of its department: every other Chief there gives it up. */
export function withOneChief<T extends OwnedBot & { id: string }>(bots: readonly T[], chief: OwnedBot & { id: string }): T[] {
  const scope = chiefScope(chief);
  return bots.map((bot) => (bot.id === chief.id || !bot.chiefOfStaff || chiefScope(bot) !== scope ? bot : { ...bot, chiefOfStaff: false }));
}
