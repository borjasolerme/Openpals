// The narrow bridge the Electron preload exposes. Absent in the browser.

declare global {
/** The package.json version, inlined by Vite's define at build time. */
const __APP_VERSION__: string;

  type DesktopCapabilities = {
    host: {
      platform: "darwin" | "linux" | "win32" | "other";
      /** The user's home folder, for showing paths as ~/… */
      homeDir?: string;
      label: string;
      session: "x11" | "wayland" | "headless" | "unknown";
      packaged: boolean;
    };
    windowChrome: "mac-inset" | "win-caption" | "native";
    /** The page draws the window's frame: false once the person turned it off. Absent on an older app, whose window
     * draws it. */
    windowFrame?: boolean;
    screenPreview: {
      available: boolean;
      interaction: "direct" | "portal-picker" | "none";
      reasonCode?: string;
    };
    dictation: {
      available: boolean;
      engine: "apple-speech" | "none";
      onDevice: boolean;
      reasonCode?: string;
    };
    localComputer: {
      available: boolean;
      support: "supported" | "limited" | "unsupported";
      enabled: boolean;
      status: "disabled" | "checking" | "starting" | "ready" | "error" | "stopped" | "unavailable";
      reasonCode?: string;
      message?: string;
      driverPath?: string;
      driverVersion?: string;
      driverSource?: "bundled" | "environment" | "user-local" | "path";
      session?: "x11" | "wayland" | "headless" | "unknown";
      compositor?: "gnome-mutter";
    };
  };

  interface DesktopWorkspaceBounds {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface BrowserSurfaceState {
    botId: string;
    open: boolean;
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward?: boolean;
    visible: boolean;
    partition?: string | null;
    profile?: string | null;
    mode?: "compact" | "expanded" | null;
    code?: "renderer-gone" | "profile-deleted" | "evicted";
  }

  interface DesktopWorkspaceState {
    contextId: string;
    open: boolean;
    status: "opening" | "ready" | "error" | "closed";
    interactive: boolean;
    code?: "load-failed" | "renderer-gone";
  }

  /** Whether the desktop is holding this computer awake for routines. */
  interface DesktopRoutineWake {
    /** the toggle */
    keepAwake: boolean;
    /** a power assertion is held right now */
    hold: boolean;
    /** "due" | "running" while held; "off" | "battery" | "idle" | "stopped" otherwise */
    reason: string;
    /** the due routine's time, when the hold is for a due routine */
    at: number | null;
    onBattery: boolean;
  }

  interface Window {
    ogb?: {
      platform: NodeJS.Platform;
      /** This app's own version, and whether this page is this app's own: false on the paired server's page, which
       * carries that server's version. Absent in desktop builds before it. */
      app?: { version: string; ownPage: boolean };
      /** Where the bots live: this computer's own server, or the one always-on server it is paired with. */
      place?: {
        /** Where the bots live now. */
        current(): Promise<{ kind: "local" } | { kind: "server"; url: string; label: string }>;
        /** Pairs with an always-on server from its one-time pairing link (https://host/pair#code=…) and opens it. */
        connect(link: string): Promise<{ ok: true } | { ok: false; error: string }>;
        /** Forgets the server and goes back to this computer. */
        disconnect(): Promise<void>;
        onChanged(callback: (place: { kind: "local" } | { kind: "server"; url: string; label: string }) => void): () => void;
      };
      /** This computer's page only: sets up an always-on server and switches this app to it. */
      serverSetup?: import("../../electron/server-setup.mjs").ServerSetupBridge;
      desktopNotices?: import("../../electron/desktop-prefs.mjs").DesktopNoticesBridge;
      /** This computer's own page only: the account's full name, for a first run's profile (system-name.mjs). */
      desktopProfile?: { systemName(): Promise<string | null> };
      desktopLanguage?: import("../../electron/desktop-prefs.mjs").DesktopLanguageBridge;
      confirm(message: string): Promise<boolean>;
      getCapabilities(): Promise<DesktopCapabilities>;
      onCapabilitiesChanged(cb: (capabilities: DesktopCapabilities) => void): () => void;
      /** Keep this computer awake for scheduled routines; absent on remote
       * server pages and in older desktop builds. */
      routines?: {
        wakeState(): Promise<DesktopRoutineWake>;
        keepAwake(enabled: boolean): Promise<DesktopRoutineWake>;
      };
      /** Local-shell-only bridge for trusted approval-mode transitions. It is
       * absent on remote server pages and in older desktop builds. */
      approvals?: {
        setMode(
          botId: string,
          mode: import("../../shared/approval-mode").ApprovalMode,
          options?: { acknowledgeLocalAuto?: boolean; threadId?: string; threadOnly?: boolean; allThreads?: boolean;
            refreshPermissions?: boolean;
            modelSelection?: import("../state/store").ModelSelection; updateBotDefault?: boolean },
        ): Promise<import("../state/store").Bot>;
      };
      localControl: {
        status(): Promise<LinuxLocalControlStatus>;
        enable(): Promise<LinuxLocalControlStatus>;
        disable(): Promise<LinuxLocalControlStatus>;
        retry(): Promise<LinuxLocalControlStatus>;
      };
      /** Arms one user-initiated display capture request from this frame. */
      beginScreenPreviewIntent(): boolean;
      screenFrame(): Promise<string | null>;
      androidDevice?: {
        status(): Promise<AndroidDeviceStatus>;
        frame(serial: string): Promise<{ serial: string; dataUrl: string }>;
        input(serial: string, payload: AndroidDeviceInput): Promise<void>;
      };
      /** Start native dictation. Call mode supplies endpointMs so silence
       * finalizes a turn; composer dictation omits it and remains manual. */
      speechStart(options?: { endpointMs?: number }): Promise<void>;
      speechStop(): Promise<void>;
      /** Finish capture and emit the recognizer's final transcript. */
      speechFinish?(): Promise<void>;
      /** This computer's page only: Settings → General's talk shortcut. */
      talkShortcut?: import("../../electron/talk-shortcut.mjs").TalkShortcutBridge;
      /** A call holds the microphone, so the talk shortcut waits. */
      callActive?(active: boolean): Promise<void>;
      onSpeechTranscript(
        cb: (line: { partial?: boolean; text?: string; error?: string }) => void,
      ): () => void;
      onSpeechEnd(cb: (info: { code: number | null; reason?: string }) => void): () => void;
      /** Absolute path of a dropped File ("" when the drag carried no
       * file on disk). Absent in older builds of the shell. */
      getPathForFile?(file: File): string;
      /** {mic} TCC status: granted|denied|not-determined|unknown. Screen
       * status is deliberately absent — macOS 15+ caches it per-process,
       * so it lies for the whole session after a grant. `pageMic`: whether
       * this app lets the asking page use the microphone (this computer's
       * page always; a server's page once the person allowed it there).
       * Absent in older builds of the shell. */
      permStatus(): Promise<{ mic: string; pageMic?: "allowed" | "refused" }>;
      /** Triggers the macOS microphone prompt; resolves true when granted. */
      permRequestMic(): Promise<boolean>;
      /** Opens System Settings on a privacy pane: mic|screen|speech|accessibility. */
      permOpenSettings(pane: "mic" | "screen" | "speech" | "accessibility"): Promise<void>;
      /** Relaunch the local desktop app through its normal shutdown cleanup. */
      relaunch?(): Promise<boolean>;
      /** Copies an engine install command and opens a blank terminal. False
       * when no terminal could be launched; the clipboard still has it. */
      openInstallTerminal?(command: string): Promise<boolean>;
      /** Writes plain text to the system clipboard; false on failure. Absent on older builds. */
      copyText?(text: string): Promise<boolean>;
      /** Opens an http(s) link in the user's default browser. */
      openExternal?(url: string): Promise<boolean>;
      /** Recolor the native window chrome for a skin; absent on older builds. */
      applySkin?(skin: string): Promise<boolean>;
      /** The window's own frame, this desktop's choice (Settings → Appearance). Absent on an older app. */
      windowFrame?: {
        state(): Promise<import("../../electron/desktop-prefs.mjs").WindowFrameState>;
        /** From the person's click on another server's page. */
        set(on: boolean): Promise<import("../../electron/desktop-prefs.mjs").WindowFrameState>;
      };
      /** The renderer-drawn Windows caption buttons; absent outside the
       * frameless Windows shell (macOS/Linux/browser keep native chrome). */
      windowControls?: {
        minimize(): Promise<boolean>;
        toggleMaximize(): Promise<boolean>;
        close(): Promise<boolean>;
        state(): Promise<{ maximized: boolean }>;
        onMaximizedChanged(cb: (maximized: boolean) => void): () => void;
      };
      /** Receives a GitHub package URL opened through openmausbot://install. */
      onPackageInstall?(cb: (url: string) => void): () => void;
      /** Receives a chat link (openmausbot://thread/… or openmausbot://bot/…)
       * opened from outside the app. */
      onChatLink?(cb: (link: string) => void): () => void;
      /** The desktop shell's app-menu Preferences… item was activated; open
       * app Settings. Every server's page in the window receives it, and the
       * bridge is absent in the browser. */
      onOpenAppSettings?(cb: () => void): () => void;
      /** Updates the native Dock/taskbar unread indicator. */
      setUnreadCount?(count: number): void;
      /** Opens a live desktop as a sandboxed window owned by OpenMausBot. */
      desktopViewer?: {
        open(url: string, title: string, contextId: string): Promise<boolean>;
        /** Closes the live-desktop window, but only when it belongs to this bot. */
        close(contextId: string): Promise<boolean>;
        /** The current viewer state, for a panel to initialize from on mount. */
        currentState(): Promise<{ open: boolean; contextId: string | null }>;
        onState(cb: (state: { open: boolean; contextId: string | null }) => void): () => void;
      };
      /** Two Local VM viewers embedded in one app window. URLs are accepted
       * only by main-process validation and never return over this bridge. */
      desktopWorkspace?: {
        open(input: {
          contextId: string;
          url: string;
          title: string;
          bounds: DesktopWorkspaceBounds;
        }): Promise<DesktopWorkspaceState>;
        layout(items: Array<{
          contextId: string;
          bounds: DesktopWorkspaceBounds;
          visible: boolean;
        }>): Promise<boolean>;
        setInteractive(contextId: string | null): Promise<boolean>;
        close(contextId?: string): Promise<boolean>;
        onState(cb: (state: DesktopWorkspaceState) => void): () => void;
      };
      /** Native folder picker; resolves null when the user cancels. */
      pickFolder?(current?: string): Promise<string | null>;
      /** Writes the redacted diagnostics report to a user-chosen file;
       * resolves the path, or null when cancelled. */
      exportDiagnostics?(): Promise<string | null>;
      /** Asks where to save a bot-created file (inside ~/.openmausbot), copies
       * it there and reveals it. Resolves the chosen path, or null if the
       * user cancelled the dialog. */
      saveFile?(filePath: string): Promise<string | null>;
      /** Desktop only: opens HTML this page already showed in the default browser, from a temp copy main writes. */
      openHtmlInBrowser?(source: string, name: string): Promise<unknown>;
      /** Points this computer's file manager at a file a bot linked outside
       * its workspace, without opening or reading it. Local app only. */
      revealInFolder?(filePath: string): Promise<"shown" | "missing" | "invalid">;
      /** Opens this app's logs folder in Explorer or Finder and says where it is. */
      openLogsFolder?(): Promise<{ folder: string; opened: boolean; error?: string }>;
      /** This app's own login item, which opens the window. `available`: false in a build that cannot add one. */
      openAtLogin?: { state(): Promise<{ available: boolean; on: boolean }>; set(on: boolean): Promise<{ available: boolean; on: boolean }> };
      /** Saved keys this launch could not read, and "Reset saved keys" (the desktop asks the person first, then restarts). */
      credentialStore?: { unreadable(): Promise<boolean>; reset(): Promise<"reset" | "cancelled" | "quitting" | "failed" | "readable"> };
      /** Save a provider credential through Electron's OS-backed store. */
      setCredential?(
        name: "openaiApiKey" | "anthropicApiKey" | "openrouterApiKey" | "mistralApiKey" | "cerebrasApiKey" | "groqApiKey" | "greenferenceApiKey" | "metaApiKey" | "deepseekApiKey" | "openaiCompatApiKey" | "composioApiKey" | "xaiApiKey" | "boxToken" | "opencodeGoApiKey" | "ttsKey" | "fishAudioKey" | "jevApiKey" | "openrouterDeciderKey" | "workersAiToken" | "openaiImageApiKey" | "customImageApiKey" | "openaiLiveKey" | "tregApiKey" | "postizApiKey",
        value: string,
        options?: { everyClaudeBot?: false },
      ): Promise<ConfigStatus>;
    };
  }
}

export interface LinuxLocalControlStatus {
  enabled: boolean;
  status: "disabled" | "checking" | "starting" | "ready" | "error" | "stopped" | "unavailable";
  reasonCode?: string;
  message?: string;
  driverPath?: string;
  driverVersion?: string;
  driverSource?: "bundled" | "environment" | "user-local" | "path";
  session?: "x11" | "wayland" | "headless" | "unknown";
  compositor?: "gnome-mutter";
  warnings?: Array<{ label: string; status: string; message: string; detail?: string }>;
}

export type AndroidUsbDevice = {
  serial: string;
  state: string;
  connection: "usb";
  model: string;
  product?: string;
  transportId?: string;
};

export type AndroidDeviceStatus = {
  available: boolean;
  reasonCode?: "adb-unavailable" | "adb-failed";
  message?: string;
  devices: AndroidUsbDevice[];
};

export type AndroidDeviceInput =
  | { type: "tap"; x: number; y: number; width: number; height: number }
  | {
      type: "swipe";
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      durationMs: number;
      width: number;
      height: number;
    }
  | { type: "key"; key: string; width?: number; height?: number }
  | { type: "text"; text: string; width?: number; height?: number };
