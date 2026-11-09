import { useEffect, useState } from "react";
import { clearWelcomeDraft } from "@/lib/welcome-draft";
import { hostedMember, LOCAL_VIEWER, welcomeDue, welcomeViewer, type WelcomeViewer } from "@/lib/onboarding";
import { api, useStore } from "@/state/store";
import { SharedWorkspaceHint } from "./SharedWorkspaceHint";
import { WelcomeFlow } from "./WelcomeFlow";

/**
 * Security: a remote page the desktop app loads gets a reduced but truthy window.ogb whose app.ownPage is false, and is
 * no more the owner than a browser.
 */
export function localDesktopPage(): boolean {
  return window.ogb?.app?.ownPage === true;
}

export function useWelcomeViewer(): WelcomeViewer | null {
  const local = localDesktopPage();
  const [viewer, setViewer] = useState<WelcomeViewer | null>(local ? LOCAL_VIEWER : null);
  useEffect(() => {
    if (local) return;
    let active = true;
    void api("/api/auth/session", { timeoutMs: 10_000 })
      .then((session) => {
        if (active) setViewer(welcomeViewer(session));
      })
      .catch(() => {
        if (active) setViewer(LOCAL_VIEWER);
      });
    return () => {
      active = false;
    };
  }, [local]);
  return viewer;
}

export function WelcomeGate({ viewer }: { viewer: WelcomeViewer | null }) {
  const { state, dispatch } = useStore();
  const [dismissed, setDismissed] = useState(false);
  // A welcome finished elsewhere (another window, an older version's record) leaves no draft behind to resume later.
  const finished = Boolean(viewer && state.config) && !welcomeDue(state.config, {
    hosted: viewer?.hosted, canSave: viewer?.canSave,
  });
  useEffect(() => {
    if (finished) clearWelcomeDraft();
  }, [finished]);
  if (!viewer) return null;
  if (hostedMember(viewer)) {
    return (
      <SharedWorkspaceHint
        replay={state.welcomeOpen}
        onClose={() => {
          if (state.welcomeOpen) dispatch({ type: "toggleWelcome", open: false });
        }}
      />
    );
  }
  const due = welcomeDue(state.config, {
    hosted: viewer.hosted,
    canSave: viewer.canSave,
  });
  // Closed or finished in this session, it waits for the next launch, or for Settings to open it again.
  if (!state.welcomeOpen && (dismissed || !due)) return null;
  const fallback = state.bots.find((b) => !b.hidden && b.chiefOfStaff) ?? state.bots.find((b) => !b.hidden) ?? null;
  const replay = state.welcomeOpen && !due;
  const close = () => {
    setDismissed(true);
    dispatch({ type: "toggleWelcome", open: false });
  };
  return (
    <WelcomeFlow
      replay={replay}
      hosted={viewer.hosted}
      onClose={close}
      onDone={(botId) => {
        close();
        // A first run ends in the chat with the bot it chose, else its Chief; the app tour starts only from Settings.
        const target = botId ?? (replay ? null : fallback?.id);
        if (target) dispatch({ type: "select", id: target });
      }}
    />
  );
}
