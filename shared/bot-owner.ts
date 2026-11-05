export interface OwnedBot {
  chiefOfStaff?: boolean;
}

/** `chief` takes the crown: every other Chief gives it up. */
export function withOneChief<T extends OwnedBot & { id: string }>(bots: readonly T[], chief: { id: string }): T[] {
  return bots.map((bot) => (bot.id === chief.id || !bot.chiefOfStaff ? bot : { ...bot, chiefOfStaff: false }));
}
