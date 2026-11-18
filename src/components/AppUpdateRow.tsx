import { useEffect, useState } from "react";

import { appVersion } from "@/lib/app-links";
import { productName } from "@/lib/brand";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { AppUpdateState } from "../../electron/app-update.mjs";
import { SettingRow } from "./SettingsPrimitives";
import { Button } from "./ui/Button";

const ERROR_KEYS: Record<NonNullable<AppUpdateState["error"]>, LocaleKey> = {
  check: "settings.updates.error.check",
  unpackaged: "settings.updates.error.unpackaged",
  verify: "settings.updates.error.verify",
  install: "settings.updates.error.install",
};

function versionTitle(update: AppUpdateState | null): string {
  const build = update?.current;
  if (!build?.commit) return `${productName()} ${appVersion()}`;
  const date = new Date(build.builtAt).toLocaleDateString(activeLocale(), { dateStyle: "medium" });
  return t("settings.updates.version", { commit: build.commit.slice(0, 7), date });
}

function status(update: AppUpdateState | null): string | undefined {
  switch (update?.state) {
    case "checking": return t("settings.updates.checking");
    case "current": return t("settings.updates.current");
    case "available": return t("settings.updates.available");
    case "downloading": return t("settings.updates.downloading", { percent: update.percent ?? 0 });
    case "verifying":
    case "installing": return t("settings.updates.installing");
    default: return undefined;
  }
}

/** Settings → General: this app's commit and build date, and Check for updates. Only in the desktop app, on its own page. */
export function AppUpdateRow() {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.updates;
  const [update, setUpdate] = useState<AppUpdateState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const off = bridge.onState((next) => { if (alive) setUpdate(next); });
    void bridge.state().then((next) => { if (alive) setUpdate((seen) => seen ?? next); }).catch(() => {});
    return () => { alive = false; off(); };
  }, [bridge]);
  if (!bridge) return null;

  const state = update?.state ?? "idle";
  const check = () => void bridge.check().then(setUpdate).catch(() => {});
  const install = () => void bridge.install().then(setUpdate).catch(() => {});
  const openPage = () => void window.ogb?.openExternal?.(update?.downloadPage ?? "").catch(() => {});
  const error = state === "error" && update?.error ? t(ERROR_KEYS[update.error]) : undefined;
  const installing = state === "downloading" || state === "verifying" || state === "installing";
  const progress = status(update);

  return (
    <div data-settings-block="updates" className="scroll-mt-4">
      <SettingRow title={versionTitle(update)} subtitle={progress && <span role="status">{progress}</span>}
        message={error ? <span role="alert" className="text-danger">{error}</span> : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {state === "available" && update?.canInstall
            ? <Button variant="primary" data-update-install onClick={install}>{t("settings.updates.install")}</Button>
            : (state === "available" || state === "error") && <Button data-update-page onClick={openPage}>{t("settings.updates.openPage")}</Button>}
          {!installing && state !== "available" &&
            <Button data-update-check disabled={state === "checking"} onClick={check}>{t("settings.updates.check")}</Button>}
        </div>
      </SettingRow>
    </div>
  );
}
