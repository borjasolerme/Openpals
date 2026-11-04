import { useEffect, useState } from "react";
import { api, useStore } from "@/state/store";
import { brandStatus } from "@/lib/brand";
import { cornerPopupWaits, firstChatQuiet, firstReplyPending } from "@/lib/corner-popup";
import { dismissNotice, GROK_MOVE_NOTICE, launchNotice, markLaunchNotice, nextNotice, noticeSeen, SIMPLE_MODE_NOTICE, TWO_PLACES_NOTICE } from "@/lib/notices";
import { useTwoPlaces } from "@/lib/two-places";
import { useSimpleModePromptSeen } from "@/lib/simple-mode-prompt";
import { welcomeFinishedThisLaunch, type WelcomeViewer } from "@/lib/onboarding";
import { launchDialogShown, markLaunchDialog } from "@/lib/launch-dialogs";
import { useMoveQuiet } from "./move-notice";
import { GrokMovePopup, type GrokMovePopupAction } from "./GrokMovePopup";
import { GrokMoveDialog } from "./lazy-screens";
import { useDesktopNotices, useOtherDialogOpen } from "./notice-dialogs";
import { localDesktopPage } from "./onboarding/WelcomeGate";
import { useMausBotWelcomeDue } from "./MausBotWelcome";
import { SimpleModePrompt } from "./SimpleModePrompt";
import { TwoPlacesCard } from "./TwoPlacesCard";

/** A first run lands in its Chief's chat, whose first messages arrive one at a time; the Grok Bot popup follows them. */
const FIRST_MESSAGES_MS = 6_000;

export function AppNotices({ quiet = false, viewer = null, now = Date.now }: { quiet?: boolean; viewer?: WelcomeViewer | null; now?: () => number }) {
  const { state, dispatch } = useStore();
  const remote = window.ogb?.remoteClient?.active === true;
  const local = localDesktopPage();
  const desktop = remote ? undefined : window.ogb?.desktopNotices;
  const desktopState = useDesktopNotices(desktop);
  const [closed, setClosed] = useState(false);
  const [grokOpen, setGrokOpen] = useState(false);
  const [grokLanded, setGrokLanded] = useState(false);
  const moving = useMoveQuiet(now);
  const mausBot = useMausBotWelcomeDue(viewer);
  // Bots in two places: this computer's page only, where main knows what lives here.
  const two = useTwoPlaces();
  const twoFact = !local || two.suggest === null ? false : two.suggest === undefined ? null : true;
  const record = state.config?.onboarding;
  // Every page with the app's chrome, desktop or server, new install or not: once per browser, as the mode is.
  const simpleDue = !useSimpleModePromptSeen();
  const simpleBlocked = useOtherDialogOpen(simpleDue) || Boolean(state.liveCall && state.liveCall.status !== "ended");
  const waits = cornerPopupWaits(state, { quiet, idle: true, viewer, duringFirstChat: true });
  const firstChat = firstReplyPending(state);
  // MausBot's first-launch card goes first: the popup waits while it is due, and skips a launch the card used.
  const afterWelcome = welcomeFinishedThisLaunch() || launchDialogShown() === "mausbot" || firstChat;
  const mausBotFirst = mausBot.due;
  // The Grok Bot popup: once for everyone who can add a bot, the one thing a first chat may be interrupted by. Nothing reads
  // this computer for it: GrokMoveDialog does that, once opened.
  const grokDue = !remote && viewer?.canSave !== false && brandStatus().source !== "file" && moving !== true
    && launchDialogShown() !== "mausbot" && !noticeSeen(record, GROK_MOVE_NOTICE) && !desktopState?.seen.includes(GROK_MOVE_NOTICE);
  const grokBlocked = useOtherDialogOpen(grokDue) || Boolean(state.liveCall && state.liveCall.status !== "ended");
  const grokLanding = welcomeFinishedThisLaunch() && !grokLanded;
  useEffect(() => {
    if (!grokDue || !grokLanding || waits) return;
    const timer = setTimeout(() => setGrokLanded(true), FIRST_MESSAGES_MS);
    return () => clearTimeout(timer);
  }, [grokDue, grokLanding, waits]);
  const grokNow = !grokDue ? false
    : !viewer || (desktop && !desktopState) || firstChat === null || mausBotFirst || moving === null || grokLanding || grokBlocked ? null : true;
  const launch = launchNotice();
  // After a closed popup nothing else follows in this launch.
  const notice = waits || closed ? null
    : firstChatQuiet(state) ? (grokNow === true && (launch === null || launch === GROK_MOVE_NOTICE) ? GROK_MOVE_NOTICE : null)
    : nextNotice({
    [GROK_MOVE_NOTICE]: grokNow,
    // Never in the launch whose welcome just finished, nor over MausBot's first-launch card.
    [SIMPLE_MODE_NOTICE]: !simpleDue || afterWelcome === true ? false : afterWelcome === null || mausBotFirst || simpleBlocked ? null : true,
    [TWO_PLACES_NOTICE]: twoFact,
  }, () => false, launch);

  useEffect(() => {
    if (!notice) return;
    markLaunchNotice(notice);
    // The popups own this launch: MausBot's first-launch card waits for a later one.
    if (notice === GROK_MOVE_NOTICE || notice === SIMPLE_MODE_NOTICE) markLaunchDialog("notices");
  }, [notice]);

  const save = (id: string) => {
    const patch = dismissNotice(record, id);
    if (patch) void api("/api/config", { method: "PUT", body: JSON.stringify(patch) })
      .then(config => dispatch({ type: "configStatus", config })).catch(() => {});
  };
  const close = () => setClosed(true);
  if (grokOpen) return <GrokMoveDialog onClose={() => setGrokOpen(false)} />;
  if (!notice) return null;

  if (notice === GROK_MOVE_NOTICE) {
    const done = (action: GrokMovePopupAction) => {
      close(); save(GROK_MOVE_NOTICE);
      void desktop?.seen(GROK_MOVE_NOTICE).catch(() => {});
      if (action === "start") setGrokOpen(true);
    };
    return <GrokMovePopup onDone={done} />;
  }

  if (notice === SIMPLE_MODE_NOTICE) return <SimpleModePrompt onClose={close} />;

  if (notice === TWO_PLACES_NOTICE && two.suggest) {
    const { key } = two.suggest;
    return <TwoPlacesCard key={key} suggest={two.suggest}
      onBring={() => two.accept(key).then(close)}
      onDismiss={() => { two.dismiss(key); close(); }} />;
  }
  return null;
}
