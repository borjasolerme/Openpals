import { useState } from "react";
import { Laptop, Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { testWorkComputer, useWorkComputers, type ConnectionTest } from "@/lib/work-computers";
import type { Bot } from "@/state/store";
import { Button } from "../ui/Button";
import { WorkComputerBadge } from "./WorkComputerBadge";

/** The Screen panel for a bot that works on one of the owner's lent Macs: which one, its state, and a look at its screen. */
export function LentComputerScreen({ bot }: { bot: Pick<Bot, "name" | "lentComputerId"> }) {
  const { computers } = useWorkComputers(true);
  const computer = computers?.find((entry) => entry.id === bot.lentComputerId) ?? null;
  const [test, setTest] = useState<ConnectionTest | "testing" | null>(null);
  const look = async () => {
    if (!computer) return;
    setTest("testing");
    setTest(await testWorkComputer(computer.id).catch((cause) => ({ ok: false as const, error: cause instanceof Error ? cause.message : String(cause) })));
  };
  return (
    <div className="mt-2 flex flex-col gap-3" data-lent-computer-screen>
      <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-3">
        <Laptop size={18} className="shrink-0 text-ink-secondary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium text-ink">{computer?.name ?? t("workComputer.mac.title")}</div>
          <div className="text-sm text-ink-secondary">{t("workComputer.screen.worksOn", { name: bot.name })}</div>
        </div>
        {computer && <WorkComputerBadge computer={computer} />}
      </div>
      <div className="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-xl bg-card">
        {test && test !== "testing" && test.ok && test.image
          ? <img alt={t("workComputer.guide.testImage", { name: computer?.name ?? "" })} src={`data:${test.image.mimeType};base64,${test.image.data}`} className="size-full object-contain" />
          : <p className="px-6 text-center text-sm text-ink-secondary">{test && test !== "testing" && !test.ok ? t("workComputer.guide.testFailed", { error: test.error }) : t("workComputer.screen.hint")}</p>}
      </div>
      <Button className="gap-1.5 self-start" disabled={!computer?.online || test === "testing"} onClick={() => void look()}>
        {test === "testing" && <Loader2 size={14} className="animate-spin" />}{t("workComputer.screen.look")}
      </Button>
    </div>
  );
}
