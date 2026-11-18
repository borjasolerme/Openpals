/** Set on the reply of a request whose computer steps were saved (`learned`), that was answered from saved steps with no
 * AI (`replayed`), or whose saved steps failed and were fixed by the AI's run (`repaired`), as `WireMessage.savedSteps`.
 * Clients that do not know it ignore it. */
export interface SavedStepsMark { recipeId: string; learned?: true; replayed?: true; repaired?: true }
