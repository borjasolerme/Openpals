import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";

/** Another bot is the Chief of Staff, who may propose changes to this one. */
function chiefCovers(bot: Bot, bots: ReadonlyArray<Bot>): boolean {
  return bots.some((candidate) => candidate.id !== bot.id && Boolean(candidate.chiefOfStaff));
}

export function ProposalStatus({ bot, kind }: { bot: Bot; kind: "chief" | "owner" }) {
  const { draft } = useBotEditor();
  const { state } = useStore();
  if (draft || !chiefCovers(bot, state.bots)) return null;
  return (
    <div className="mt-1 text-sm leading-snug text-ink-secondary">
      {t(kind === "chief" ? "botSettings.proposal.chief" : "botSettings.proposal.owner")}
    </div>
  );
}
