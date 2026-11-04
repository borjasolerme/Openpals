import { ChevronRight, MessagesSquare } from "lucide-react";
import { openBot, useStore, type Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";
import { HandoffReply } from "./HandoffReply";

/** A teammate's work in a thread of its own: the pill opens that teammate's chat, where a question it has waits. */
export function ThreadChip({ message }: { message: Message }) {
  const { state, dispatch } = useStore();
  const ref = message.threadRef;
  const tool = message.tool;
  if (!ref || !tool) return null;
  const bot = state.bots.find((candidate) => candidate.id === ref.botId);
  const direct = message.sentDirectly;
  const label = !direct ? tool.name
    : direct.room ? t("chat.sentDirectlyNotInRoom", { name: direct.name, room: direct.room }) : t("chat.sentDirectly", { name: direct.name });
  return (
    <HandoffReply message={message}>
      <button
        type="button"
        data-thread-chip={ref.threadId}
        disabled={!bot}
        onClick={() => bot && openBot(dispatch, bot)}
        title={bot ? t("chat.openConversationWith", { name: bot.name }) : undefined}
        className={cn("ui-pill", tool.ok === false && "text-danger")}
      >
        {bot ? <BotAvatar bot={bot} state="happy" size={16} animated={false} /> : <MessagesSquare size={13} aria-hidden="true" />}
        <span className="max-w-[480px] truncate">{label}</span>
        <ChevronRight size={13} />
      </button>
    </HandoffReply>
  );
}
