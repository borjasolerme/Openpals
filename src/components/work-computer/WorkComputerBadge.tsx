import { t } from "@/lib/i18n";
import { workComputerState, type WorkComputer } from "@/lib/work-computers";
import { Badge, type BadgeTone } from "../ui/Badge";

const STATE_TONE: Record<ReturnType<typeof workComputerState>, BadgeTone> = {
  online: "success", busy: "accent", paused: "warning", offline: "neutral", stopped: "outline",
};

/** Connected, in use, paused, offline or no longer shared: a lent computer's state in one word. */
export function WorkComputerBadge({ computer }: { computer: Pick<WorkComputer, "online" | "busy" | "paused" | "lent"> }) {
  const state = workComputerState(computer);
  return <Badge tone={STATE_TONE[state]} data-work-computer-state={state}>{t(`workComputer.mac.state.${state}`)}</Badge>;
}
