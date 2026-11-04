import { useState } from "react";
import type { PlaceSwatch } from "../../electron/place-look.mjs";
import { t } from "@/lib/i18n";
import { choosePlaceColor, usePlaceLook } from "@/lib/place-look";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useStore } from "@/state/store";
import { PlacePicture } from "./PlacePicture";
import { SettingRow, SettingsRows, SIMPLE_BUTTONS } from "./SettingsPrimitives";
import { SwatchRadios } from "./SwatchRadios";

/** The sidebar's look, as two rows of Settings: its colour, in the six swatches the rail's circles use, and its picture,
 * kept on the place's own server for everyone there. Both start plain. The colour is this app's own; a browser knows no
 * colour, only the picture. */
export function PlaceLookRows() {
  const look = usePlaceLook();
  const { state } = useStore();
  const admin = useOwnerOrAdmin() === true;
  const computer = window.ogb?.app?.ownPage === true;
  const [pending, setPending] = useState<PlaceSwatch | null>(null);
  const [failed, setFailed] = useState(false);
  const choose = (swatch: PlaceSwatch) => {
    if (!look || pending || swatch === look.swatch) return;
    setPending(swatch); setFailed(false);
    void choosePlaceColor(swatch).then((answer) => { setPending(null); setFailed(answer === "failed"); });
  };
  return <>
    {look && <div data-place-look>
      <SettingRow title={t("placeLook.sidebarColor")} subtitle={computer ? t("placeLook.sidebarColorSub") : t("placeLook.sub", { name: look.name })}
        message={failed ? <p role="alert" className="text-danger">{t("placeLook.failed")}</p> : null}>
        <SwatchRadios value={pending ?? look.swatch} onChange={choose} label={computer ? t("placeLook.sidebarColor") : t("placeLook.aria", { name: look.name })}
          offset="menu" none />
      </SettingRow>
    </div>}
    <PlacePicture banner={state.config?.workspaceBanner ?? null} canChange={admin} subtitle={t(computer ? "placeLook.sidebarPictureSub" : "placeLook.pictureSub")} />
  </>;
}

/** The same rows in a card of their own, in the Simple look in Advanced too. */
export function PlaceLookCard() {
  return <div data-sidebar-look data-settings-look="simple" className={SIMPLE_BUTTONS}>
    <SettingsRows><PlaceLookRows /></SettingsRows>
  </div>;
}
