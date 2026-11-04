// Borja's local customizations of upstream OpenMausBot, kept in one place so updates rebase cleanly.
// Each switch is off in the app and on under Vitest, so upstream's own tests keep checking the code it hides.

const inTests = import.meta.env?.MODE === "test";

/** Departments (sidebar sections): off = one flat list of bots, no section headers or "Move to section". */
export const BOT_SECTIONS_ENABLED = inTests;
