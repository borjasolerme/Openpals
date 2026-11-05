// About me, the profile every bot reads: facts bots learn into it, and lines a person asks a bot to forget.
import { appendAboutMe, commitLearned, planLearned } from "./profile-learned.ts";

const LEARNED_PREFIX = /^\s*-\s*\d{4}-\d{2}-\d{2} · learned by [^·\n]* · /;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** A learned line is judged by its fact, never by the bot that learned it. */
export function withoutMentionedLines(aboutMe: string, mentions: (text: string) => boolean): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = aboutMe.split("\n").filter((line) => {
    const fact = line.replace(LEARNED_PREFIX, "").replace(BULLET, "").trim();
    if (!fact || !mentions(fact)) return true;
    removed.push(fact);
    return false;
  });
  return { text: kept.join("\n"), removed };
}

type Plan = (current: string) => { next: string; count: number } | null;

export interface AboutMeDeps {
  read(): string;
  write(text: string): void;
  /** Clients are told after the learned facts are recorded, so a reload sees both. */
  changed(): void;
  today(): string;
}

export type AboutMe = ReturnType<typeof createAboutMe>;

export function createAboutMe(deps: AboutMeDeps) {
  const learnPlan = (from: { botId: string; botName: string }, texts: readonly string[]) => {
    let facts: ReturnType<typeof planLearned> = [];
    const plan: Plan = (current) => {
      facts = planLearned(from, texts, current, deps.today());
      const next = appendAboutMe(current, facts.map((fact) => fact.line));
      return facts.length && next !== null ? { next, count: facts.length } : null;
    };
    return { plan, facts: () => facts };
  };
  return {
    learn(from: { botId: string; botName: string }, texts: readonly string[]): number {
      const { plan, facts } = learnPlan(from, texts);
      const planned = plan(deps.read());
      if (!planned) return 0;
      deps.write(planned.next);
      commitLearned(facts());
      deps.changed();
      return planned.count;
    },
    /** The facts removed from the person's About me. */
    forget(mentions: (text: string) => boolean): string[] {
      let removed: string[] = [];
      const plan: Plan = (current) => {
        const kept = withoutMentionedLines(current, mentions);
        removed = kept.removed;
        return kept.removed.length ? { next: kept.text, count: kept.removed.length } : null;
      };
      const planned = plan(deps.read());
      if (!planned) return [];
      deps.write(planned.next);
      deps.changed();
      return removed;
    },
  };
}
