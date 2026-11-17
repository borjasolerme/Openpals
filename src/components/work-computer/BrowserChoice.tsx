import { useState } from "react";
import { Globe, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { builtInBrowserEnabled } from "@/lib/feature-flags";
import { browserProfilesMutation, newBrowserProfileId } from "@/lib/browser-profiles";
import { t } from "@/lib/i18n";
import { api, useStore, type Bot, type BotAnnouncement, type BrowserProfile, type ConfigStatus } from "@/state/store";
import { Select } from "../Select";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

/** A bot's browser: its own, or a shared profile (an existing one, or a new one still to be made). */
export type BrowserChoice = { kind: "own" } | { kind: "shared"; id: string | null; name: string };

export function defaultBrowserChoice(): BrowserChoice {
  return { kind: "own" };
}

/** The profile id the bot uses; a new shared profile is saved first. Throws when it can't be saved. */
export async function browserProfileFor(choice: BrowserChoice, profiles: BrowserProfile[],
  onConfig: (config: ConfigStatus) => void): Promise<string | null> {
  if (choice.kind === "own") return null;
  if (choice.id) return choice.id;
  const id = newBrowserProfileId();
  const name = choice.name.trim() || t("newBotBrowser.defaultName");
  const config: ConfigStatus = await api("/api/config", {
    method: "PATCH",
    body: JSON.stringify(browserProfilesMutation(profiles, [...profiles, { id, name }])),
  });
  onConfig(config);
  return id;
}

function Option({ selected, disabled, onClick, icon: Icon, title, desc }: {
  selected: boolean; disabled: boolean; onClick: () => void; icon: typeof Globe; title: string; desc: string;
}) {
  return (
    <button type="button" aria-pressed={selected} disabled={disabled} onClick={onClick}
      className={cn("min-w-0 rounded-lg border px-2.5 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-accent/60 bg-accent/10" : "border-hairline/50 hover:bg-control/60")}>
      <span className="flex items-center gap-2 text-sm font-medium text-ink"><Icon size={14} className="shrink-0 text-ink-secondary" />{title}</span>
      <span className="mt-1 block text-xs leading-4 text-ink-secondary">{desc}</span>
    </button>
  );
}

/** "Its own browser or a shared one?" Hidden while the built-in browser is off. With onConfirm, a new profile waits
 * for its button; without, the caller saves it later (New bot's Create). */
export function BrowserChoicePicker({ value, onChange, onConfirm, disabled = false, note, className }: {
  value: BrowserChoice; onChange: (choice: BrowserChoice) => void; onConfirm?: () => void;
  disabled?: boolean; note?: string; className?: string;
}) {
  const { state } = useStore();
  if (!builtInBrowserEnabled(state.config)) return null;
  const profiles = state.config?.browserProfiles ?? [];
  const newName = t("newBotBrowser.defaultName");
  const firstShared = (): BrowserChoice => profiles[0] ? { kind: "shared", id: profiles[0].id, name: profiles[0].name } : { kind: "shared", id: null, name: newName };
  return (
    <section className={className} aria-labelledby="bot-browser-title">
      <h3 id="bot-browser-title" className="text-base font-medium text-ink">{t("newBotBrowser.title")}</h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Option selected={value.kind === "own"} disabled={disabled} onClick={() => { if (value.kind !== "own") onChange({ kind: "own" }); }}
          icon={Globe} title={t("newBotBrowser.own")} desc={t("newBotBrowser.ownDesc")} />
        <Option selected={value.kind === "shared"} disabled={disabled} onClick={() => { if (value.kind !== "shared") onChange(firstShared()); }}
          icon={Users} title={t("newBotBrowser.shared")} desc={t("newBotBrowser.sharedDesc")} />
      </div>
      {value.kind === "shared" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {profiles.length > 0 && (
            <Select aria-label={t("newBotBrowser.which")} value={value.id ?? ""} className="min-w-48" disabled={disabled}
              onChange={(event) => {
                const picked = profiles.find((profile) => profile.id === event.target.value);
                onChange(picked ? { kind: "shared", id: picked.id, name: picked.name } : { kind: "shared", id: null, name: newName });
              }}>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              <option value="">{t("newBotBrowser.newProfile")}</option>
            </Select>
          )}
          {value.id === null && (
            <label className="flex min-w-48 flex-1 items-center gap-2 text-sm text-ink-secondary">
              <span className="shrink-0">{t("newBotBrowser.nameLabel")}</span>
              <Input value={value.name} maxLength={100} className="min-w-0 flex-1" disabled={disabled}
                onChange={(event) => onChange({ kind: "shared", id: null, name: event.target.value })} />
            </label>
          )}
          {value.id === null && onConfirm && (
            <Button variant="primary" disabled={disabled || !value.name.trim()} onClick={onConfirm}>{t("newBotBrowser.createAndUse")}</Button>
          )}
        </div>
      )}
      {note ? <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{note}</p> : null}
    </section>
  );
}

/** New bot's step: the choice is kept until Create. */
export function NewBotBrowserChoice({ value, onChange }: { value: BrowserChoice; onChange: (choice: BrowserChoice) => void }) {
  return <BrowserChoicePicker className="mt-5" value={value} onChange={onChange} />;
}

/** A bot's settings: picking applies at once; a new shared profile is made with its button. */
export function BotBrowserChoice({ bot, className = "mt-4 border-t border-hairline/40 pt-4" }: { bot: Bot; className?: string }) {
  const { state, dispatch, flushBotPatches } = useStore();
  const [draft, setDraft] = useState<BrowserChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const profiles = state.config?.browserProfiles ?? [];
  const current: BrowserChoice = bot.browserProfile && bot.browserProfile !== "guest"
    ? { kind: "shared", id: bot.browserProfile, name: profiles.find((profile) => profile.id === bot.browserProfile)?.name ?? "" }
    : { kind: "own" };
  const apply = async (choice: BrowserChoice) => {
    setSaving(true);
    setError("");
    try {
      const browserProfile = await browserProfileFor(choice, profiles, (config) => dispatch({ type: "configStatus", config }));
      // Drain coalesced settings edits first, so an older queued patch cannot put the bot back on its previous browser.
      await flushBotPatches(bot.id);
      const result: { bot: BotAnnouncement } = await api(`/api/bots/${encodeURIComponent(bot.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ browserProfile }),
      });
      dispatch({ type: "botPatched", bot: result.bot });
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.profiles.saveError"));
    } finally {
      setSaving(false);
    }
  };
  const busy = bot.busy === true;
  return (
    <div className={className} data-bot-browser-choice aria-busy={saving}>
      <BrowserChoicePicker
        value={draft ?? current}
        disabled={saving || busy}
        note={busy ? t("settings.profiles.stopToSwitch") : t("newBotBrowser.signInOnce")}
        onChange={(choice) => {
          if (choice.kind === "shared" && choice.id === null) setDraft(choice);
          else void apply(choice);
        }}
        onConfirm={() => { if (draft) void apply(draft); }}
      />
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
