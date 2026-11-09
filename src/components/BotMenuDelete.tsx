import { Loader2, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { MenuItem } from "./ui/MenuItem";

export function BotDeleteMenuItem({ deleting, onClick }: { deleting: boolean; onClick: () => void }) {
  return (
    <MenuItem
      disabled={deleting}
      aria-busy={deleting || undefined}
      onClick={onClick}
      title={deleting ? t("sidebar.bot.deleteCheckingTitle") : undefined}
      tone="danger"
      icon={deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
      label={deleting ? t("sidebar.bot.deleteChecking") : t("common.delete")}
    />
  );
}
