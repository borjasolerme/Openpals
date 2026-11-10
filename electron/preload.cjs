// contextIsolation stays on: the renderer sees only window.ogb, never Node or ipcRenderer.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

let pendingPackageInstallUrl = null;
const packageInstallListeners = new Set();
ipcRenderer.on("package:install", (_event, url) => {
  if (typeof url !== "string") return;
  pendingPackageInstallUrl = url;
  for (const listener of packageInstallListeners) listener(url);
});

let pendingChatLink = null;
const chatLinkListeners = new Set();
ipcRenderer.on("chat:open", (_event, link) => {
  if (typeof link !== "string") return;
  if (!chatLinkListeners.size) {
    pendingChatLink = link;
    return;
  }
  for (const listener of chatLinkListeners) listener(link);
});

// Never a destination supplied by a renderer: the menu only opens Settings.
const appSettingsListeners = new Set();
ipcRenderer.on("app:open-settings", () => {
  for (const listener of appSettingsListeners) listener();
});

// The full bridge goes only to the local server's UI; a remote page gets the safe subset, and main enforces the same rule.
const localOrigin = process.argv.find((arg) => arg.startsWith("--omb-local-origin="))?.slice("--omb-local-origin=".length) ?? null;
const isLocalPage = !localOrigin || location.origin === localOrigin;

const REMOTE_SAFE = new Set(["platform", "app", "getCapabilities", "onCapabilitiesChanged", "applySkin", "setUnreadCount", "permStatus", "place", "desktopNotices", "desktopLanguage", "windowControls", "onOpenAppSettings", "windowFrame"]);
function savedLanguageChoice() {
  try { const saved = ipcRenderer.sendSync("desktop-language:read"); return typeof saved === "string" ? saved : null; } catch { return null; }
}
let languageChoice;
const languageListeners = new Set();
ipcRenderer.on("desktop-language:changed", (_event, language) => {
  if (typeof language !== "string") return;
  languageChoice = language;
  for (const listener of languageListeners) listener(language);
});
// main passes app.getVersion(): a server's page carries that server's version, so About asks this for the app's own.
const appVersion = (process.argv.find((arg) => arg.startsWith("--omb-app-version="))?.slice("--omb-app-version=".length) ?? "").slice(0, 64);

/** ipcRenderer wraps a main-process throw in "Error invoking remote method"; the page shows the text verbatim. */
function invokeWithPlainError(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((error) => {
    const message = String(error?.message ?? error);
    throw new Error(message.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ""));
  });
}

const bridge = {
  platform: process.platform,
  /** This app's version, and whether this page is this app's own (served by this computer, not the server it is connected to). */
  app: { version: appVersion, ownPage: isLocalPage },
  /**
   * Where the bots live: this computer, or the one always-on server this window shows. Safe on that server's page: it
   * learns only itself, and connects or disconnects only from the person's click.
   */
  place: {
    /** Where the bots live now: `{ kind: "local" }` or `{ kind: "server", url, label }`. */
    current: () => ipcRenderer.invoke("place:current"),
    /** Pairs with an always-on server from its one-time pairing link (https://host/pair#code=…) and opens it. Resolves
     * `{ ok: true }`, or `{ ok: false, error }` with "cancelled" when the person declined main's confirmation and
     * "unreachable" when the server didn't answer. */
    connect: (link) => isLocalPage || navigator.userActivation?.isActive === true
      ? ipcRenderer.invoke("place:connect", String(link)) : Promise.reject(new Error("Choose Connect to connect to a server.")),
    /** Forgets the server and goes back to this computer. */
    disconnect: () => isLocalPage || navigator.userActivation?.isActive === true
      ? ipcRenderer.invoke("place:disconnect").then(() => undefined) : Promise.reject(new Error("Choose Disconnect to go back to this computer.")),
    onChanged: (cb) => {
      const handler = (_event, place) => cb(place);
      ipcRenderer.on("place:changed", handler);
      return () => ipcRenderer.removeListener("place:changed", handler);
    },
  },
  /** This computer's page only: sets up an always-on server and switches to it (electron/server-setup.d.mts). */
  serverSetup: {
    start: (request) => ipcRenderer.invoke("server-setup:start", request?.kind === "ssh"
      ? { kind: "ssh", address: String(request.address ?? "") } : { kind: "boat", key: String(request?.key ?? "") }),
    onProgress: (cb) => {
      const handler = (_event, progress) => cb(progress);
      ipcRenderer.on("server-setup:progress", handler);
      return () => ipcRenderer.removeListener("server-setup:progress", handler);
    },
  },
  // The window's own frame, this desktop's choice for every page of its window; a server's page changes it only from the
  // person's click.
  windowFrame: {
    state: () => ipcRenderer.invoke("window-frame:state"),
    set: (on) => isLocalPage || navigator.userActivation?.isActive === true
      ? ipcRenderer.invoke("window-frame:set", on === true) : Promise.reject(new Error("Choose to turn the window frame on or off.")),
  },
  getCapabilities: () => ipcRenderer.invoke("desktop:capabilities"),
  onCapabilitiesChanged: (cb) => {
    const handler = (_event, capabilities) => cb(capabilities);
    ipcRenderer.on("desktop:capabilities-changed", handler);
    return () => ipcRenderer.removeListener("desktop:capabilities-changed", handler);
  },
  companion: {
    state: () => ipcRenderer.invoke("companion:state"),
    start: () => ipcRenderer.invoke("companion:start"),
    stop: () => ipcRenderer.invoke("companion:stop"),
    keepAwake: (enabled) => ipcRenderer.invoke("companion:keep-awake", enabled),
    refreshTailscale: () => ipcRenderer.invoke("companion:refresh-tailscale"),
    pairing: (open, expectedToken) => ipcRenderer.invoke("companion:pairing", open, expectedToken),
    cloudDesktop: (deviceId, allowed) => ipcRenderer.invoke("companion:cloud-desktop", deviceId, allowed),
    browserControl: (deviceId, allowed) => ipcRenderer.invoke("companion:browser-control", deviceId, allowed),
    revoke: (deviceId) => ipcRenderer.invoke("companion:revoke", deviceId),
  },
  routines: {
    wakeState: () => ipcRenderer.invoke("routines:wake-state"),
    keepAwake: (enabled) => ipcRenderer.invoke("routines:keep-awake", enabled),
  },
  /** Full/Custom never go through the loopback API, only the embedded server's private utilityProcess port. */
  approvals: {
    setMode: (botId, mode, options) => ipcRenderer.invoke("approvals:set-trusted-mode", botId, mode, options),
  },
  localControl: {
    status: () => ipcRenderer.invoke("cua:linux-status"),
    enable: () => ipcRenderer.invoke("cua:linux-enable"),
    disable: () => ipcRenderer.invoke("cua:linux-disable"),
    retry: () => ipcRenderer.invoke("cua:linux-retry"),
  },
  /** Arms exactly one display-media request from the current renderer frame. */
  beginScreenPreviewIntent: () => ipcRenderer.sendSync("screen:preview-intent"),
  screenFrame: () => ipcRenderer.invoke("screen:frame"),
  /** Physical USB devices only; network ADB is deliberately excluded. */
  androidDevice: {
    status: () => ipcRenderer.invoke("android-device:status"),
    frame: (serial) => ipcRenderer.invoke("android-device:frame", serial),
    input: (serial, payload) =>
      ipcRenderer.invoke("android-device:input", serial, payload).then(() => undefined),
  },
  speechStart: (options) => ipcRenderer.invoke("speech:start", options),
  speechStop: () => ipcRenderer.invoke("speech:stop"),
  speechFinish: () => ipcRenderer.invoke("speech:finish"),
  onSpeechTranscript: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on("speech:transcript", handler);
    return () => ipcRenderer.removeListener("speech:transcript", handler);
  },
  onSpeechEnd: (cb) => {
    const handler = (_event, info) => cb(info);
    ipcRenderer.on("speech:end", handler);
    return () => ipcRenderer.removeListener("speech:end", handler);
  },
  talkShortcut: {
    state: () => ipcRenderer.invoke("talk-shortcut:state"),
    set: (change) => ipcRenderer.invoke("talk-shortcut:set", {
      ...(typeof change?.enabled === "boolean" ? { enabled: change.enabled } : {}),
      ...(typeof change?.key === "string" ? { key: change.key } : {}),
    }),
  },
  callActive: (active) => ipcRenderer.invoke("call:active", active === true).then(() => undefined),
  onOpenAppSettings: (cb) => {
    appSettingsListeners.add(cb);
    return () => appSettingsListeners.delete(cb);
  },
  /** Electron 32 removed File.path, and only the preload can ask. */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  /** No screen field: macOS 15+ caches that status per process, so it would lie after a grant. */
  permStatus: () => ipcRenderer.invoke("perm:status"),
  permRequestMic: () => ipcRenderer.invoke("perm:request-mic"),
  permOpenSettings: (pane) => ipcRenderer.invoke("perm:open-settings", pane),
  relaunch: () => ipcRenderer.invoke("desktop:relaunch"),

  openInstallTerminal: (command) => ipcRenderer.invoke("engine:open-terminal", command),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  /** Unlike window.open, this still works after an asynchronous API request. */
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  applySkin: (skin) => ipcRenderer.invoke("desktop:skin", skin),
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    state: () => ipcRenderer.invoke("window:state"),
    onMaximizedChanged: (cb) => {
      const handler = (_event, maximized) => cb(maximized);
      ipcRenderer.on("window:maximized-changed", handler);
      return () => ipcRenderer.removeListener("window:maximized-changed", handler);
    },
  },
  onPackageInstall: (cb) => {
    packageInstallListeners.add(cb);
    if (pendingPackageInstallUrl) cb(pendingPackageInstallUrl);
    return () => packageInstallListeners.delete(cb);
  },
  onChatLink: (cb) => {
    chatLinkListeners.add(cb);
    if (pendingChatLink) {
      const link = pendingChatLink;
      pendingChatLink = null;
      cb(link);
    }
    return () => chatLinkListeners.delete(cb);
  },
  setUnreadCount: (count) => ipcRenderer.send("desktop:unread-count", count),
  desktopViewer: {
    open: (url, title, contextId) => ipcRenderer.invoke("desktop-viewer:open", url, title, contextId),
    close: (contextId) => ipcRenderer.invoke("desktop-viewer:close", contextId),
    currentState: () => ipcRenderer.invoke("desktop-viewer:state-now"),
    onState: (cb) => {
      const handler = (_event, state) => cb(state);
      ipcRenderer.on("desktop-viewer:state", handler);
      return () => ipcRenderer.removeListener("desktop-viewer:state", handler);
    },
  },
  desktopWorkspace: {
    open: (input) => ipcRenderer.invoke("desktop-workspace:open", input),
    layout: (items) => ipcRenderer.invoke("desktop-workspace:layout", items),
    setInteractive: (contextId) => ipcRenderer.invoke("desktop-workspace:set-interactive", contextId),
    close: (contextId) => ipcRenderer.invoke("desktop-workspace:close", contextId),
    onState: (cb) => {
      const handler = (_event, state) => cb(state);
      ipcRenderer.on("desktop-workspace:state", handler);
      return () => ipcRenderer.removeListener("desktop-workspace:state", handler);
    },
  },
  pickFolder: (current) => ipcRenderer.invoke("desktop:pick-folder", current),
  exportDiagnostics: () => ipcRenderer.invoke("desktop:export-diagnostics"),
  saveFile: (filePath) => invokeWithPlainError("desktop:save-file", filePath),
  revealInFolder: (filePath) => ipcRenderer.invoke("desktop:reveal-file", filePath),
  openHtmlInBrowser: (source, name) => invokeWithPlainError("desktop:open-html", source, name),
  // This app's own logs folder (server.log, desktop-crashes.log); the page names no path.
  openLogsFolder: () => ipcRenderer.invoke("desktop:open-logs"),
  openAtLogin: {
    state: () => ipcRenderer.invoke("open-at-login:state"),
    set: on => on !== true || isLocalPage || navigator.userActivation?.isActive === true
      ? ipcRenderer.invoke("open-at-login:set", on === true) : Promise.reject(new Error("Turn on the switch to open Openpals at login.")),
  },
  setCredential: (name, value, options) => ipcRenderer.invoke("credential:set", name, value, options),
  // Saved keys this launch could not read, and "Reset saved keys" (main asks the person first, then restarts).
  credentialStore: {
    unreadable: () => ipcRenderer.invoke("credential-store:unreadable"),
    reset: () => ipcRenderer.invoke("credential-store:reset"),
  },

  confirm: message => ipcRenderer.invoke("dialog:confirm", message),
  desktopProfile: {
    systemName: () => ipcRenderer.invoke("desktop-profile:system-name"),
  },
  desktopNotices: {
    state: () => ipcRenderer.invoke("desktop-notices:state"),
    seen: id => ipcRenderer.invoke("desktop-notices:seen", String(id)),
  },
  desktopLanguage: {
    choice: () => {
      if (languageChoice === undefined) languageChoice = savedLanguageChoice();
      return languageChoice;
    },
    set: language => {
      languageChoice = String(language);
      return ipcRenderer.invoke("desktop-language:set", languageChoice);
    },
    onChange: listener => {
      languageListeners.add(listener);
      return () => { languageListeners.delete(listener); };
    },
  },
};

contextBridge.exposeInMainWorld(
  "ogb",
  isLocalPage ? bridge : Object.fromEntries(Object.entries(bridge).filter(([key]) => REMOTE_SAFE.has(key))),
);
