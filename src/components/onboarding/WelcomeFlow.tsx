import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ArrowRight, X } from "lucide-react";
import { productName } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { stageIntro } from "@/lib/default-bot";
import { GLASS_POPUP_GUTTER, glassPopupTopInset } from "@/lib/glass-popup";
import { t } from "@/lib/i18n";
import { GROK_MOVE_NOTICE } from "@/lib/notices";
import { beatsFor, completionPatch, firstRunPatch, markWelcomeFinished, resumeBeat, type BeatId } from "@/lib/onboarding";
import { disconnectServer, placeAvailable, useBotsPlace, type BotsPlace } from "@/lib/place";
import { clearWelcomeDraft, readWelcomeDraft, saveWelcomeDraft } from "@/lib/welcome-draft";
import type { LocaleKey } from "@/locales";
import { api, useStore } from "@/state/store";
import { AiStep } from "./AiStep";
import { BringBots, firstBot, NOTHING_BROUGHT, type BroughtBots } from "./BringBots";
import { ConnectApps } from "./ConnectApps";
import { ConnectStep, type PlaceKind } from "./ConnectStep";
import { HostedWelcomeArt } from "./HostedWelcome";
import { localDesktopPage } from "./WelcomeGate";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

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
/** Where Enter belongs to the control itself, not to the window's Continue. */
const OWNS_ENTER = "input, textarea, select, button, a[href], summary, [contenteditable='true']";

/** Tab and Shift+Tab stay inside `root`, the way a modal dialog keeps them. */
function trapTab(event: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (event.key !== "Tab" || !root) return;
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Clears the macOS traffic lights and the Windows caption buttons where the window has them. */
function frameStyle(): CSSProperties | undefined {
  const top = glassPopupTopInset();
  // SAFETY: React passes custom properties through; CSSProperties just does not list them.
  return top > GLASS_POPUP_GUTTER ? ({ "--welcome-top": `${top}px` } as CSSProperties) : undefined;
}

/** The app dimmed behind the first run's window. */
function Frame({ embedded, children }: { embedded: boolean; children?: ReactNode }) {
  return (
    <div className={cn("welcome-frame", embedded && "welcome-frame-embedded")} style={frameStyle()}>
      <div aria-hidden="true" className="ui-scrim absolute inset-0" />
      {children}
    </div>
  );
}

const STEP_LABEL: Readonly<Record<BeatId, LocaleKey>> = {
  welcome: "onboarding.welcome.start",
  place: "onboarding.steps.connect",
  ai: "onboarding.steps.ai",
  bring: "onboarding.steps.bring",
};

/** The steps across the top: the one shown is current; one already reached opens again. */
function Stepper({ beats, beat, reached, onGo }: { beats: readonly BeatId[]; beat: BeatId; reached: number; onGo: (beat: BeatId) => void }) {
  return (
    <nav aria-label={t("onboarding.steps.label")} className="shrink-0 px-4 pt-2 sm:px-6">
      <ol className="flex gap-0.5 rounded-xl bg-fill-subtle p-1 sm:gap-1">
        {beats.map((id, at) => {
          const current = id === beat;
          return (
            <li key={id} className="min-w-0 flex-1">
              <button type="button" data-welcome-step={id} aria-current={current ? "step" : undefined} disabled={at > reached}
                onClick={() => onGo(id)}
                className={cn("flex h-8 w-full min-w-0 items-center justify-center gap-1 rounded-lg px-1 text-sm leading-5 transition-colors disabled:cursor-default sm:gap-1.5 sm:px-1.5 sm:text-base",
                  current ? "bg-menu font-medium text-ink shadow-sm" : "text-ink-secondary enabled:hover:text-ink disabled:opacity-50")}>
                <span aria-hidden="true" className={cn("flex size-4.5 shrink-0 items-center justify-center rounded-full text-xs font-medium leading-none",
                  current ? "bg-ink text-app" : "bg-fill")}>{at + 1}</span>
                <span className="truncate">{t(STEP_LABEL[id])}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const HEADING: Readonly<Record<BeatId, { title: LocaleKey; line: LocaleKey }>> = {
  welcome: { title: "onboarding.welcome.title", line: "onboarding.hosted.intro" },
  place: { title: "botsHome.title", line: "botsHome.welcomeLine" },
  ai: { title: "onboarding.ai.title", line: "onboarding.ai.line" },
  bring: { title: "onboarding.bring.title", line: "onboarding.bring.line" },
};

/** The first run as one window over the app: where the bots live (desktop app only), the AI, then bots and apps to
 * bring, each a step of the stepper, with Continue at the bottom. Its end is the chat with the bot brought here
 * (`onDone`); its X and Escape close it to finish later (`onClose`), keeping the step it was on. A hosted place's admin
 * gets its welcome only. */
export function WelcomeFlow(props: {
  onDone: (botId: string | null) => void;
  onClose: () => void;
  replay?: boolean;
  initialBeat?: BeatId;
  embedded?: boolean;
  hosted?: boolean;
}) {
  const place = useBotsPlace();
  // The desktop app answers where the bots live before the window shows; a browser has no question to ask.
  if (placeAvailable() && !place) return <Frame embedded={props.embedded ?? false} />;
  return <Steps {...props} place={place} />;
}

function Steps({ onDone, onClose, replay = false, initialBeat, embedded = false, hosted = false, place }: Parameters<typeof WelcomeFlow>[0] & { place: BotsPlace | null }) {
  const { state, dispatch } = useStore();
  // A first run keeps its step in this browser, so a reload or a close resumes it; a replay starts over. A hosted
  // place's browser may hold another person's draft.
  const keepsDraft = !replay && !embedded && !hosted;
  const [beats] = useState(() => beatsFor({ hosted, place: Boolean(place) }));
  const [beat, setBeat] = useState<BeatId>(() => resumeBeat(beats, initialBeat ?? (keepsDraft ? readWelcomeDraft()?.beat : undefined)));
  const [reached, setReached] = useState(() => beats.indexOf(beat));
  const [brought, setBrought] = useState<BroughtBots>(NOTHING_BROUGHT);
  const [choice, setChoice] = useState<PlaceKind>(place?.kind ?? "local");
  const [placeError, setPlaceError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
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
    body.current?.scrollTo?.({ top: 0 });
  }, [beat]);

  // A server this app just paired with is where the bots live now.
  const placeKind = place?.kind;
  useEffect(() => {
    if (placeKind) setChoice(placeKind);
  }, [placeKind]);

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
        // The bring step offered the move from Grok Bot, so its popup has nothing left to offer.
        const patch = replay ? completionPatch() : firstRunPatch(record.current, new Date(), beats.includes("bring") ? [GROK_MOVE_NOTICE] : []);
        const config = await api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
        dispatch({ type: "configStatus", config });
      } catch {
      }
    },
    [dispatch, onDone, replay, embedded, keepsDraft, brought.pal, beats],
  );

  const at = beats.indexOf(beat);
  const go = (to: BeatId) => {
    setBeat(to);
    setReached((furthest) => Math.max(furthest, beats.indexOf(to)));
  };
  const leavingServer = beat === "place" && place?.kind === "server" && choice === "local";
  const next = async () => {
    // Choosing this computer on a server's page goes back to it: the app opens this computer's page instead. The
    // button says so ("Disconnect and continue") and the step explains it, so it never happens unannounced.
    if (leavingServer) {
      setPlaceError(null);
      try {
        await disconnectServer();
      } catch (cause) {
        setPlaceError(cause instanceof Error ? cause.message : String(cause));
      }
      return;
    }
    const following = beats[at + 1];
    if (following) go(following);
    else void finish(firstBot(brought));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // A dialog opened from a step (Connect an AI, Move from Grok Bot) owns its own keys.
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (event.defaultPrevented || target?.closest('[role="dialog"]') !== root.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && !target?.closest(OWNS_ENTER)) {
      event.preventDefault();
      root.current?.querySelector<HTMLButtonElement>("[data-primary]:not([disabled])")?.click();
    } else {
      trapTab(event, root.current);
    }
  };

  const heading = HEADING[beat];
  const last = at === beats.length - 1;
  const primary = beat === "welcome" ? t("onboarding.welcome.start") : leavingServer ? t("botsHome.leaveServer")
    : last ? t("onboarding.bring.openApp") : t("onboarding.continue");
  return (
    <Frame embedded={embedded}>
      <div
        ref={root}
        role="dialog"
        aria-modal
        aria-labelledby="welcome-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-welcome={beat}
        className={cn("welcome-screen ui-modal animate-pop-in relative flex max-h-full w-full max-w-150 flex-col overflow-hidden rounded-4xl outline-none",
          beats.length > 1 && "min-h-[min(560px,100%)]")}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 pl-4 pr-3 pt-3 sm:pl-6">
          <span className="text-base font-semibold text-ink">{productName()}</span>
          <IconButton data-welcome-close="" onClick={onClose} label={t("onboarding.later")} className="rounded-full" icon={<X size={16} aria-hidden="true" />} />
        </div>
        {beats.length > 1 && <Stepper beats={beats} beat={beat} reached={reached} onGo={go} />}
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-5 [scrollbar-width:thin] sm:px-6">
          <div key={beat} className={cn("animate-fade-in flex flex-col gap-5", beat === "welcome" && "items-center pt-6 text-center")}>
            {beat === "welcome" && <HostedWelcomeArt />}
            <div className="flex flex-col gap-1.5">
              <h1 id="welcome-title" className="text-2xl font-semibold text-ink [text-wrap:balance]">{t(heading.title)}</h1>
              <p className="text-base text-ink-secondary [text-wrap:pretty]">{t(heading.line)}</p>
            </div>
            {beat === "place" && place && <ConnectStep place={place} choice={choice} onChoose={setChoice} error={placeError} />}
            {beat === "ai" && <AiStep />}
            {beat === "bring" && (
              <div className="flex flex-col gap-6">
                <BringBots brought={brought} onBrought={setBrought} />
                <ConnectApps />
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline/40 px-4 py-3 sm:px-6">
          {at > 0 ? <Button size="lg" onClick={() => go(beats[at - 1]!)}>{t("onboarding.back")}</Button> : <span />}
          <Button variant="primary" size="lg" data-primary="" onClick={() => void next()}>
            {primary}
            {!last && beat !== "welcome" && <ArrowRight size={14} aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </Frame>
  );
}
