/** A Chief of Staff's powers: creating, configuring and deleting bots, rooms and routines through its tools, retrying a
 * teammate's thread, and its approval level passing down to the work it hands out. */
export function chiefLevel(bot: { chiefOfStaff?: boolean } | null | undefined): boolean {
  return bot?.chiefOfStaff === true;
}

/** The role switch a bot's agents tools are listed under: the Chief-only tools. */
export function roleToolEnv(bot: { chiefOfStaff?: boolean } | null | undefined): { OMB_CHIEF_OF_STAFF: "1" | "0" } {
  return { OMB_CHIEF_OF_STAFF: chiefLevel(bot) ? "1" : "0" };
}
