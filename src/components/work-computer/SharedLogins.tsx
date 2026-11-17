import { useState } from "react";
import { builtInBrowserEnabled } from "@/lib/feature-flags";
import { browserProfilesMutation, newBrowserProfileId } from "@/lib/browser-profiles";
import { t } from "@/lib/i18n";
import type { MausColor } from "@/lib/mascot";
import { api, useStore, type Bot, type BotAnnouncement, type BrowserProfile, type ConfigStatus } from "@/state/store";
import { NoteRow, SwitchRow } from "../bot-panel/rows";

/** The shared browser profile: the first one there is, or a new one named Shared, saved first. Throws when it can't be. */
export async function sharedProfileId(profiles: BrowserProfile[], onConfig: (config: ConfigStatus) => void): Promise<string> {
  if (profiles[0]) return profiles[0].id;
  const id = newBrowserProfileId();
  const config: ConfigStatus = await api("/api/config", {
    method: "PATCH",
    body: JSON.stringify(browserProfilesMutation(profiles, [{ id, name: t("sharedLogins.profileName") }])),
  });
  onConfig(config);
  return id;
}

/** One switch: this bot's browser shares its sign-ins with the other bots that have it on. Hidden while the built-in
 * browser is off. */
export function SharedLoginsRow({ checked, onChange, color, disabled = false, hint }: {
  checked: boolean; onChange: () => void; color: MausColor; disabled?: boolean; hint?: string;
}) {
  const { state } = useStore();
  if (!builtInBrowserEnabled(state.config)) return null;
  return (
    <SwitchRow data-panel-row="shared-logins" title={t("sharedLogins.title")} hint={hint ?? t("sharedLogins.hint")}
      checked={checked} onChange={onChange} disabled={disabled} color={color} label={t("sharedLogins.title")} />
  );
}

/** A bot's Shared sign-ins switch, applied at once. */
export function BotSharedLogins({ bot }: { bot: Bot }) {
  const { state, dispatch, flushBotPatches } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const shared = Boolean(bot.browserProfile && bot.browserProfile !== "guest");
  const busy = bot.busy === true;
  const toggle = async () => {
    setSaving(true);
    setError("");
    try {
      const browserProfile = shared ? null
        : await sharedProfileId(state.config?.browserProfiles ?? [], (config) => dispatch({ type: "configStatus", config }));
      // Drain coalesced settings edits first, so an older queued patch cannot put the bot back on its previous browser.
      await flushBotPatches(bot.id);
      const result: { bot: BotAnnouncement } = await api(`/api/bots/${encodeURIComponent(bot.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ browserProfile }),
      });
      dispatch({ type: "botPatched", bot: result.bot });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.profiles.saveError"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <SharedLoginsRow checked={shared} color={bot.color} disabled={saving || busy} onChange={() => void toggle()}
        hint={busy ? t("settings.profiles.stopToSwitch") : undefined} />
      {error ? <NoteRow tone="warn">{error}</NoteRow> : null}
    </>
  );
}
