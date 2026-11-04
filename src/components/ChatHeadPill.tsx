import { ChevronRight, Lock, UserRound, Users } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { ELEVATED_FLOAT, ELEVATED_HOVER } from "./elevated";
import { BOT_PANEL_ID } from "./bot-panel/side-panel";

const CHEVRON_MOTION = "duration-[140ms] ease-[cubic-bezier(.22,1,.36,1)]";

export type ChatHeadPrivacy = { kind: "private" } | { kind: "ownHelper" } | { kind: "shared"; team: string } | null;

const PRIVACY_ICONS = { private: Lock, ownHelper: UserRound, shared: Users } as const;

function privacyLabelOf(privacy: ChatHeadPrivacy): string | null {
  switch (privacy?.kind) {
    case "private": return t("team.privateHeader");
    case "ownHelper": return t("team.ownHelperHeader");
    case "shared": return t("team.sharedHeader", { team: privacy.team });
    default: return null;
  }
}

/** Simple mode's whole chat header: the bot's face and name in one pill, which opens and closes the bot panel. A team
 * chat says who can read it with one quiet glyph. */
export function ChatHeadPill({ bot, avatar, privacy, onToggle }: {
  bot: Bot;
  avatar: Pick<ComponentProps<typeof BotAvatar>, "state" | "motion" | "motionKey" | "animated">;
  privacy: ChatHeadPrivacy;
  onToggle: () => void;
}) {
  const { state } = useStore();
  const open = state.settingsOpen;
  const privacyLabel = privacyLabelOf(privacy);
  const PrivacyIcon = privacy ? PRIVACY_ICONS[privacy.kind] : Users;
  const label = t("chat.openProfileAria", { name: bot.name });
  return (
    <button
      type="button"
      data-chathead-pill
      data-tour="bot-pill"
      onClick={onToggle}
      title={t("chat.openProfile")}
      aria-label={label}
      aria-expanded={open}
      aria-controls={open ? BOT_PANEL_ID : undefined}
      className={cn("group flex min-w-0 max-w-full items-center gap-2 rounded-full py-[7.5px] pl-[7.5px] pr-[13.5px] text-ink", ELEVATED_FLOAT, ELEVATED_HOVER)}
    >
      <BotAvatar bot={bot} size={24} {...avatar} />
      <span dir="auto" className="min-w-0 truncate text-[14px] font-medium leading-5">{bot.name}</span>
      {privacyLabel && (
        <span data-chathead-privacy={privacy?.kind} title={privacyLabel} className="flex shrink-0 text-ink-tertiary">
          <PrivacyIcon size={13} aria-hidden="true" />
          <span className="sr-only">{privacyLabel}</span>
        </span>
      )}
      {!open && (
        <span aria-hidden="true" data-chathead-chevron className={cn("-ml-2 flex w-0 shrink-0 overflow-hidden opacity-0 transition-[width,margin,opacity] group-hover:ml-0 group-hover:w-2 group-hover:opacity-100 group-focus-visible:ml-0 group-focus-visible:w-2 group-focus-visible:opacity-100", CHEVRON_MOTION)}>
          <ChevronRight size={12} className={cn("-ml-0.5 shrink-0 -translate-x-1.5 text-ink-tertiary transition-transform group-hover:translate-x-0 group-focus-visible:translate-x-0", CHEVRON_MOTION)} />
        </span>
      )}
    </button>
  );
}
