import { Crown } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { Badge } from "./ui/Badge";

export function SidebarBotRole({ role }: { role: string }) {
  return (
    <span data-testid="bot-role" className="@container -ms-1.5 min-w-0 grow">
      <span title={role} className="block truncate ps-1.5 text-base font-normal text-ink-secondary @max-[3rem]:sr-only">
        <span className="sr-only">, </span>{role}
      </span>
    </span>
  );
}

export function ChatHeadRole({ bot }: { bot: Pick<Bot, "title" | "chiefOfStaff"> }) {
  const role = bot.title.trim();
  const repeatsChiefBadge = bot.chiefOfStaff && role.toLocaleLowerCase() === t("chat.chiefOfStaff").toLocaleLowerCase();
  if (!role || repeatsChiefBadge) return null;
  return (
    <span data-chathead-role className="flex min-w-0 max-w-fit grow basis-0">
      <span title={role} className="max-w-[16rem] truncate text-base text-ink-secondary">{role}</span>
    </span>
  );
}

export function chiefOfStaffBadge(bot: Bot) {
  if (!bot.chiefOfStaff) return null;
  return (
    <Badge tone="accent" title={t("chat.chiefOfStaff")} className="@max-4xl/chathead:px-1.5" icon={<Crown size={11} aria-hidden="true" />}>
      <span className="@max-4xl/chathead:sr-only">{t("chat.chiefOfStaff")}</span>
    </Badge>
  );
}
