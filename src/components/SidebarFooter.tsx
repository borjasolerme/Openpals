import { cn } from "@/lib/cn";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { useStore } from "@/state/store";

import { SidebarConnectApps } from "./SidebarConnectApps";
import { SidebarBottomButtons, SidebarFooterNav } from "./SidebarFooterNav";
import { phoneSettingsAction, SidebarPhoneButton } from "./SidebarPhoneButton";
import { SidebarProfileMenu, useSimpleAccount, type ArchivedBots } from "./SidebarProfileMenu";

function SimpleSidebarFooter({ archived }: { archived?: ArchivedBots }) {
  const account = useSimpleAccount(archived);
  return (
    <div data-sidebar-footer="simple" className="px-4 pb-4 pt-2">
      <div className="flex items-center gap-2">
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
