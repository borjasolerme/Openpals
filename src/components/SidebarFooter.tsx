import { useRef } from "react";

import { cn } from "@/lib/cn";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { useStore } from "@/state/store";

import { AccountMoveStatus, useAccountMoveLine } from "./AccountMove";
import { useWorkspacePlace, type WorkspacePlace } from "./DesktopWorkspaceSwitcher";
import { SidebarConnectApps } from "./SidebarConnectApps";
import { SidebarBottomButtons, SidebarFooterNav } from "./SidebarFooterNav";
import { phoneSettingsAction, SidebarPhoneButton } from "./SidebarPhoneButton";
import { SidebarProfileMenu, useSimpleAccount, type ArchivedBots } from "./SidebarProfileMenu";

export function useSimplePlace(): WorkspacePlace {
  return useWorkspacePlace();
}

export function SidebarPlaceStatus({ place, className }: { place: WorkspacePlace; className?: string }) {
  if (place.error) return <p role="alert" className={cn("text-[12px] text-danger", className)}>{place.error}</p>;
  return null;
}

function SimpleSidebarFooter({ archived }: { archived?: ArchivedBots }) {
  const place = useSimplePlace();
  const account = useSimpleAccount(place, archived);
  const move = useAccountMoveLine();
  const footer = useRef<HTMLDivElement>(null);
  // The move's words open the account menu just below them, where the move's row is.
  const openAccount = () => footer.current?.querySelector("[data-sidebar-account]")?.closest("button")?.click();
  return (
    <div ref={footer} data-sidebar-footer="simple" className="px-4 pb-4 pt-2">
      <SidebarPlaceStatus place={place} className="mb-2 px-1" />
      <AccountMoveStatus kind={move.kind} place={move.place} retry={move.retry} onOpen={openAccount} className="ps-1" />
      <div className="flex items-center gap-2 not-first:mt-2">
        <SidebarProfileMenu simple={account} />
        <SidebarConnectApps />
      </div>
    </div>
  );
}

export function SidebarFooter({ density, simple = false, archived, toolsCollapsed, onToggleTools }: {
  density: SidebarDensity;
  simple?: boolean;
  archived?: ArchivedBots;
  toolsCollapsed: boolean;
  onToggleTools?: () => void;
}) {
  const { dispatch } = useStore();
  if (simple) return <SimpleSidebarFooter archived={archived} />;
  return (
    <div className={cn("pb-3 pt-2", density === "icons" ? "flex flex-col items-center gap-1 px-2" : "px-3")}>
      <SidebarFooterNav density={density} collapsed={toolsCollapsed} onToggleCollapsed={onToggleTools} />
      {density === "icons" ? (
        <>
          <SidebarPhoneButton density={density} onOpen={() => dispatch(phoneSettingsAction())} />
          <div className="flex flex-col items-center justify-center gap-1">
            <SidebarProfileMenu iconOnly />
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1 not-first:mt-3">
            <div className="min-w-0 flex-1">
              <SidebarProfileMenu />
            </div>
            <SidebarBottomButtons />
          </div>
        </>
      )}
    </div>
  );
}
