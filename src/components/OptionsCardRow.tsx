import type { ReactNode } from "react";
import type { Bot, Message } from "@/state/store";
import { ApprovalCard } from "./ApprovalCard";
import { MessageBoundary } from "./MessageBoundary";
import { OptionCard, shouldHideOnboardingCard } from "./OptionCard";
import { QuestionCard } from "./QuestionCard";
import { isQuestionCard } from "@/lib/question-card";
import type { Asker } from "./AskCard";

/**
 * Called, not mounted: a quiz that dropped out must come back as null so the transcript draws no row and no day
 * separator.
 */
function typedPast(card: Message, transcript: Message[]): boolean {
  const index = transcript.findIndex((entry) => entry.id === card.id);
  return index >= 0 && transcript.slice(index + 1).some((later) => later.role === "user" && later.kind === "text");
}

export function optionsCardRow({ message: m, transcript, botId, botName, botColor, threadId, asker }: {
  message: Message;
  transcript: Message[];
  botId: string;
  botName: string;
  botColor?: Bot["color"];
  threadId: string;
  /** The bot that asks. */
  asker?: Asker;
}): ReactNode {
  const card = isQuestionCard(m.card) ? (
    <QuestionCard threadId={threadId} asker={asker ?? (botColor ? { name: botName, color: botColor } : undefined)} message={m} typedPast={typedPast(m, transcript)} />
  ) : m.card?.requestId && m.card.tool ? (
    <ApprovalCard bot={{ name: botName }} message={m} threadId={threadId} />
  ) : shouldHideOnboardingCard(m, transcript) ? null : (
    <OptionCard botId={botId} threadId={threadId} message={m} />
  );
  if (!card) return null;
  return (
    <MessageBoundary fallbackText={m.card?.subtitle || m.card?.title || ""}>
      {card}
    </MessageBoundary>
  );
}
