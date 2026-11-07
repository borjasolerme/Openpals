import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { stageIntro } from "@/lib/default-bot";
import { GROK_MOVE_NOTICE } from "@/lib/notices";
import { beatsFor, completionPatch, firstRunPatch, markWelcomeFinished, resumeBeat, type BeatId } from "@/lib/onboarding";
import { desktopShowsOtherServer } from "@/lib/other-server";
import { placeAvailable, useBotsPlace } from "@/lib/place";
import { clearWelcomeDraft, readWelcomeDraft, saveWelcomeDraft } from "@/lib/welcome-draft";
import { api, useStore } from "@/state/store";
import { AppsStep } from "./AppsStep";
import { BotsStep, firstBot, NOTHING_BROUGHT, type BroughtBots } from "./BotsStep";
import { DoneStep } from "./DoneStep";
import { PlaceStep } from "./PlaceStep";
import { SignInStep } from "./SignInStep";
import type { StepProgress } from "./StepFrame";
import { localDesktopPage } from "./WelcomeGate";
import { WelcomeStep } from "./WelcomeStep";

type Config = ReturnType<typeof useStore>["state"]["config"];

/** A genuine first run on this computer's own page names the person after its account, where their profile has none
 * (never on a remote page). The name stays theirs to change in Settings. */
async function nameFromComputer(config: Config, done: (config: NonNullable<Config>) => void): Promise<void> {
  const bridge = window.ogb;
  if (!config || config.onboarding?.completedAt || config.profile?.name?.trim()) return;
  if (!localDesktopPage()) return;
  const name = await bridge?.desktopProfile?.systemName().catch(() => null);
  if (!name) return;
  try {
    done(await api<NonNullable<Config>>("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name } }), signal: AbortSignal.timeout(10_000) }));
  } catch {
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab stay inside `root`, the way a modal dialog keeps them. */
function trapTab(event: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (event.key !== "Tab" || !root) return;
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** The steps between the welcome and the end are counted. */
function progressOf(beats: readonly BeatId[], beat: BeatId): StepProgress | null {
  const counted: readonly BeatId[] = beats.filter((id) => id !== "welcome" && id !== "done");
  const at = counted.indexOf(beat);
  return at < 0 ? null : { current: at + 1, total: counted.length };
}

/** The first run, one screen at a time: welcome, where the bots live (desktop app only), the AI, the bots, the apps, then
 * done. Its end is the chat with the bot brought here (`onDone`). */
export function WelcomeFlow(props: {
  onDone: (botId: string | null) => void;
  replay?: boolean;
  initialBeat?: BeatId;
  embedded?: boolean;
  hosted?: boolean;
}) {
  const place = useBotsPlace();
  // The desktop app answers where the bots live before the first screen shows; a browser has no question to ask.
  if (placeAvailable() && !place) return <div className={cn("bg-app", props.embedded ? "h-full w-full" : "fixed inset-0 z-50")} />;
  return <Steps {...props} place={place?.kind === "local"} />;
}

function Steps({ onDone, replay = false, initialBeat, embedded = false, hosted = false, place }: Parameters<typeof WelcomeFlow>[0] & { place: boolean }) {
  const { state, dispatch } = useStore();
  // A first run keeps its screen in this browser, so a reload resumes it; a replay starts over. A hosted place's
  // browser may hold another person's draft.
  const keepsDraft = !replay && !embedded && !hosted;
  const [beats] = useState(() => beatsFor({ hosted, place, welcomed: desktopShowsOtherServer() }));
  const [beat, setBeat] = useState<BeatId>(() => resumeBeat(beats, initialBeat ?? (keepsDraft ? readWelcomeDraft()?.beat : undefined)));
  const [brought, setBrought] = useState<BroughtBots>(NOTHING_BROUGHT);
  const root = useRef<HTMLDivElement>(null);
  const finishing = useRef(false);
  const record = useRef(state.config?.onboarding);
  record.current = state.config?.onboarding;

  useEffect(() => {
    if (keepsDraft && !finishing.current) saveWelcomeDraft({ beat });
  }, [beat, keepsDraft]);

  useEffect(() => {
    if (!replay && !embedded && !hosted) void nameFromComputer(state.config, (config) => dispatch({ type: "configStatus", config }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    root.current?.scrollTo?.({ top: 0 });
  }, [beat]);

  const finish = useCallback(
    async (botId: string | null) => {
      if (finishing.current) return;
      finishing.current = true;
      if (!replay && !embedded) markWelcomeFinished();
      if (keepsDraft) clearWelcomeDraft();
      // Pal started here says its first lines one at a time as its chat opens.
      if (!replay && botId && botId === brought.pal) stageIntro(botId);
      onDone(botId);
      try {
        // The bots step offered the move from Grok Bot, so its popup has nothing left to offer.
        const patch = replay ? completionPatch() : firstRunPatch(record.current, new Date(), beats.includes("bots") ? [GROK_MOVE_NOTICE] : []);
        const config = await api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
        dispatch({ type: "configStatus", config });
      } catch {
      }
    },
    [dispatch, onDone, replay, embedded, keepsDraft, brought.pal, beats],
  );

  const at = beats.indexOf(beat);
  const next = () => {
    const following = beats[at + 1];
    if (following) setBeat(following);
    else void finish(firstBot(brought));
  };
  const back = at > 0 ? () => setBeat(beats[at - 1]!) : undefined;
  const progress = progressOf(beats, beat);

  // Enter on the screen itself presses its main button while it can be pressed.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && event.target === root.current) {
      event.preventDefault();
      root.current.querySelector<HTMLButtonElement>("[data-primary]:not([disabled])")?.click();
      return;
    }
    trapTab(event, root.current);
  };

  const target = firstBot(brought);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal
      aria-labelledby="welcome-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-welcome={beat}
      className={cn("welcome-screen flex flex-col overflow-y-auto bg-app outline-none", embedded ? "relative h-full w-full" : "fixed inset-0 z-50")}
    >
      <div key={beat} className="flex w-full flex-1 shrink-0 flex-col">
        {beat === "welcome" ? <WelcomeStep hosted={hosted} onNext={next} />
          : beat === "place" ? <PlaceStep progress={progress} onBack={back} onNext={next} />
          : beat === "ai" ? <SignInStep progress={progress} onBack={back} onNext={next} />
          : beat === "bots" ? <BotsStep progress={progress} brought={brought} onBrought={setBrought} onBack={back} onNext={next} />
          : beat === "apps" ? <AppsStep progress={progress} onBack={back} onNext={next} />
          : <DoneStep bot={state.bots.find((bot) => bot.id === target)} onBack={back} onDone={() => void finish(target)} />}
      </div>
    </div>
  );
}
