import { useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import { SKINS, THEME_SKINS, applySkinChoice, readSkinChoice, subscribeSkin, type SkinChoice } from "@/lib/skins";
import { SettingRow } from "./SettingsPrimitives";
import { SegmentedControl } from "./ui/SegmentedControl";

const THEMES = [
  { choice: "system", label: "settings.theme.system" },
  { choice: THEME_SKINS.light, label: "settings.theme.light" },
  { choice: THEME_SKINS.dark, label: "settings.theme.dark" },
] as const satisfies readonly { choice: SkinChoice; label: string }[];

export function useSkinChoice(): SkinChoice {
  return useSyncExternalStore(subscribeSkin, readSkinChoice, readSkinChoice);
}

export function ThemeRow({ simple = false }: { simple?: boolean }) {
  const choice = useSkinChoice();
  const look = THEMES.some((theme) => theme.choice === choice) ? undefined : SKINS.find((skin) => skin.id === choice)?.name;
  return (
    <SettingRow
      title={t("settings.theme.title")}
      subtitle={look ? t("settings.theme.look", { name: look }) : simple ? undefined : t("settings.theme.subtitle")}
    >
      <SegmentedControl
        label={t("settings.theme.title")}
        options={THEMES.map((theme) => ({ value: theme.choice, label: t(simple && theme.choice === "system" ? "settings.simple.theme.system" : theme.label) }))}
        value={choice}
        onChange={applySkinChoice}
      />
    </SettingRow>
  );
}
