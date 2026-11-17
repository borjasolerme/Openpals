import { Globe, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { builtInBrowserEnabled } from "@/lib/feature-flags";
import { browserProfilesMutation, newBrowserProfileId } from "@/lib/browser-profiles";
import { t } from "@/lib/i18n";
import { api, useStore, type BrowserProfile, type ConfigStatus } from "@/state/store";
import { Select } from "../Select";
import { Input } from "../ui/Input";

/** A new bot's browser: its own, or a shared profile (an existing one, or a new one made on Create). */
export type BrowserChoice = { kind: "own" } | { kind: "shared"; id: string | null; name: string };

export function defaultBrowserChoice(): BrowserChoice {
  return { kind: "own" };
}

/** The profile id the new bot uses; a new shared profile is saved first. Throws when it can't be saved. */
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

function Option({ selected, onClick, icon: Icon, title, desc }: {
  selected: boolean; onClick: () => void; icon: typeof Globe; title: string; desc: string;
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick}
      className={cn("min-w-0 rounded-lg border px-2.5 py-2.5 text-left", selected ? "border-accent/60 bg-accent/10" : "border-hairline/50 hover:bg-control/60")}>
      <span className="flex items-center gap-2 text-sm font-medium text-ink"><Icon size={14} className="shrink-0 text-ink-secondary" />{title}</span>
      <span className="mt-1 block text-xs leading-4 text-ink-secondary">{desc}</span>
    </button>
  );
}

/** "Its own browser or a shared one?", asked in the new-bot step. Hidden when the built-in browser is off. */
export function NewBotBrowserChoice({ value, onChange }: { value: BrowserChoice; onChange: (choice: BrowserChoice) => void }) {
  const { state } = useStore();
  if (!builtInBrowserEnabled(state.config)) return null;
  const profiles = state.config?.browserProfiles ?? [];
  const newName = t("newBotBrowser.defaultName");
  const shared = (): BrowserChoice => profiles[0] ? { kind: "shared", id: profiles[0].id, name: profiles[0].name } : { kind: "shared", id: null, name: newName };
  return (
    <section className="mt-5" aria-labelledby="new-bot-browser-title">
      <h3 id="new-bot-browser-title" className="text-base font-medium text-ink">{t("newBotBrowser.title")}</h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Option selected={value.kind === "own"} onClick={() => onChange({ kind: "own" })} icon={Globe}
          title={t("newBotBrowser.own")} desc={t("newBotBrowser.ownDesc")} />
        <Option selected={value.kind === "shared"} onClick={() => { if (value.kind !== "shared") onChange(shared()); }} icon={Users}
          title={t("newBotBrowser.shared")} desc={t("newBotBrowser.sharedDesc")} />
      </div>
      {value.kind === "shared" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {profiles.length > 0 && (
            <Select aria-label={t("newBotBrowser.which")} value={value.id ?? ""} className="min-w-48"
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
              <Input value={value.name} maxLength={100} className="min-w-0 flex-1"
                onChange={(event) => onChange({ kind: "shared", id: null, name: event.target.value })} />
            </label>
          )}
        </div>
      )}
    </section>
  );
}
