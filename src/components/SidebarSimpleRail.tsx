import { SidebarConnectApps } from "./SidebarConnectApps";
import { SidebarProfileMenu, useSimpleAccount, type ArchivedBots } from "./SidebarProfileMenu";

export function SidebarRailSeparator() {
  return <div aria-hidden="true" data-sidebar-rail-separator="" className="mx-auto my-1.5 h-px w-8 shrink-0 bg-hairline/70" />;
}

export function SimpleRailFooter({ archived }: { archived?: ArchivedBots }) {
  const account = useSimpleAccount(archived);
  return (
    <div data-sidebar-rail-footer="" className="relative flex flex-col items-center gap-2 px-2 pb-4 pt-2">
      <SidebarConnectApps circle />
      <SidebarProfileMenu iconOnly rail simple={account} />
    </div>
  );
}
