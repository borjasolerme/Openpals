import type { HelperFollowupField } from "./helper-followup.ts";
import type { MausColor } from "./wire.ts";

/** Pal (MausBot upstream): the built-in helper. A new install's first bot (its Chief of Staff too); an existing place
 * without one is given one once. It can be renamed and recoloured, hidden from the sidebar, never deleted. */
export const DEFAULT_BOT_NAME = "Pal";
/** The helper's name before the fork; installs made then may still have an unmarked starter bot by this name. */
export const LEGACY_DEFAULT_BOT_NAME = "MausBot";
export const DEFAULT_BOT_COLOR: MausColor = "chrome";

export interface DefaultBotFields {
  /** This bot is its place's MausBot. Never deleted or archived. */
  defaultBot?: Record<string, never>;
  /** Settings → General "Show MausBot in the sidebar" is off: the bot keeps working, only its sidebar row is gone. */
  sidebarHidden?: boolean;
  /** Its person has seen MausBot's first-launch welcome here and chose Add or Not now. */
  welcomed?: boolean;
}

export interface HelperIntroField extends HelperFollowupField {
  /** MausBot's introduction. Clients that know it say it in the viewer's language with example asks; `text` is the
   * English fallback the model and older clients read. */
  helperIntro?: true;
}
