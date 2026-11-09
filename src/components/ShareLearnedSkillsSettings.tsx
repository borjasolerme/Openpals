import { useState } from "react";

import { shareLearnedSkillsMode, skillAuthoringEnabled, skillsLibraryEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { SkillReviewSettings } from "./SkillReviewSettings";
import { SegmentedControl } from "./ui/SegmentedControl";

const MODES = [
  { value: "off", label: "settings.experimental.shareSkillsOff" },
  { value: "ask", label: "settings.experimental.shareSkillsAsk" },
  { value: "auto", label: "settings.experimental.shareSkillsAuto" },
] as const;

export function ShareLearnedSkillsSettings() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!skillsLibraryEnabled(state.config)) return null;
  const authoring = skillAuthoringEnabled(state.config);
  const mode = shareLearnedSkillsMode(state.config);

  const choose = async (next: (typeof MODES)[number]["value"]) => {
    if (saving || next === mode) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { shareLearnedSkills: next } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 border-t border-hairline/30 pt-4" data-testid="share-learned-skills-settings">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-medium text-ink">{t("settings.experimental.shareSkills")}</div>
          <div className="mt-0.5 text-sm leading-relaxed text-ink-secondary">
            {t(authoring ? "settings.experimental.shareSkillsDetail" : "settings.experimental.shareSkillsNeedsAuthoring")}
          </div>
        </div>
        <SegmentedControl
          label={t("settings.experimental.shareSkillsAria")}
          options={MODES.map((option) => ({ value: option.value, label: t(option.label), disabled: saving || !authoring }))}
          value={mode}
          onChange={(next) => void choose(next)}
        />
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}

export function LearnedSkillsSettings() {
  return (
    <>
      <SkillReviewSettings />
      <ShareLearnedSkillsSettings />
    </>
  );
}
