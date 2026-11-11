import { app, BrowserWindow, Tray, WebContentsView, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, powerSaveBlocker, safeStorage, screen, session, shell, systemPreferences, utilityProcess, nativeTheme } from "electron";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildErrorPage, desktopViewerErrorPage } from "./error-pages.mjs";
import { startCua, stopCua, registerCuaIpc, setCuaStateListener, grantLocalComputer } from "./cua.mjs";
import { createAndroidDeviceController } from "./android-device.mjs";
import { finishSpeech, speechBusy, startSpeech, stopSpeech } from "./speech.mjs";
import { installTalk, isTalkPanel } from "./talk-main.mjs";
import { openBlankTerminal } from "./terminal-launch.mjs";
import { linuxDisablesGpu } from "./linux-gpu.mjs";
import { pasteMenuItem } from "./paste-menu-item.mjs";
import {
  appendDesktopCrashRecord,
  buildDiagnosticsReport,
  diagnosticsFileName,
  formatDesktopCrashRecord,
  installDesktopCrashListeners,
  readSafeLogTail,
} from "./diagnostics.mjs";
import { migrateWorkspaceCredentials, workspaceCredentialEnv } from "./workspace-credentials.mjs";
import { evictStartupCacheOnce } from "./startup-cache-eviction.mjs";
import { activateExistingWindow } from "./single-instance.mjs";
import { bootFailureMessage, listeningSignal, pollServerIdentity, SERVER_BOOT_TIMEOUT_MS, SERVER_LISTENING_GRACE_MS } from "./server-boot-probe.mjs";
import { createServerSupervisor } from "./server-supervisor.mjs";
import { serverChildLaunch } from "./server-child-launch.mjs";
import { packageUrlFromCommandLine, packageUrlFromDeepLink } from "./package-link.mjs";
import { chatLinkFrom, chatLinkFromCommandLine } from "./chat-link.mjs";
import { windowBackground, windowChromeOptions } from "./window-chrome.mjs";
import { createAllWindowsClosedQuit } from "./window-all-closed.mjs";
import { createStartupScreen } from "./startup-screen.mjs";
import { createSystemTray } from "./system-tray.mjs";
let startupScreen = null;
let desktopTray = null;
import { collisionFreeDownloadPath, defaultSaveName, openHtmlCopy, openLogsFolder, revealDownloadWhenDone, revealInFolder, withSavableFile } from "./save-file.mjs";
import { desktopViewerPermissionAllowed } from "./desktop-viewer-permissions.mjs";
import { appPermissionHandlers, externalLinkUrl } from "./app-permissions.mjs";
import { appFrameNavigationAllowed } from "./app-frame-guard.mjs";
import { writeClipboardText } from "./clipboard-write.mjs";
import { createSecureCredentialState } from "./secure-credential-state.mjs";
import {
  createPhoneSecretSaveCoordinator,
  createPhoneSecretIdentity,
  decodePhoneSecretSaveRequest,
  phoneSecretPrivateKeyMessage,
  readPhoneSecretIdentity,
  withPhoneSecretIdentity,
} from "./phone-secret-identity.mjs";
import { isKnownSkin, skinChrome } from "./skin-overlay.cjs";
import { installCredentialStoreIpc, readSecureCredentials } from "./secure-credentials.mjs";
import capabilitiesModule from "./capabilities.cjs";
import environmentsModule from "./environments.cjs";
import localOriginModule from "./local-origin.cjs";
import { buildApplicationMenu } from "./menu.mjs";
import { acquireDataDirLease } from "./data-dir-lease.mjs";
import { createDesktopPrefs, DESKTOP_PORTS, jsonFile, registerDesktopPrefs } from "./desktop-prefs.mjs";
import { createOpenAtLogin, installOpenAtLogin } from "./open-at-login.mjs";
import { askForMicrophone, openPrivacySettings } from "./privacy-settings.mjs";
import { createWindowStateFile } from "./window-state-file.mjs";
import { createPlaceFile } from "./environments-file.mjs";
import { installServerSessions, reportOwnListeners } from "./server-session.mjs";
import { setupOnBoat } from "./boat-setup.mjs";
import { setupOverSsh } from "./ssh-setup.mjs";

const { desktopCapabilities, nativeDesktopActions } = capabilitiesModule;
const nativeActions = nativeDesktopActions(process.platform);
const require = createRequire(import.meta.url);
const { createDisplayMediaGuard, invokeDisplayMediaCallback, selectCaptureSource } = require(
  "./screen-preview.cjs",
);
const { STAGE_PREFIX: APPIMAGE_CUA_STAGE_PREFIX } = require("./cua-linux-bundle.cjs");
const { desktopViewerUrl, sameDesktopViewerOrigin } = require("./desktop-viewer.cjs");
const { createDesktopWorkspaceManager } = require("./desktop-workspace.cjs");
const { createTrustedApprovalModeCoordinator } = require("./approval-trusted-mode.cjs");
const { DESKTOP_MUTATION_HEADER, desktopServerHeaders } = require("./desktop-server-auth.cjs");
const { MIN_BOUNDS, normalizeUnreadCount, resolveWindowState } = require("./window-state.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// vite binds IPv4; a bare "localhost" can resolve to ::1.
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://127.0.0.1:5199";
let SERVER_PORT = 8799;
const APP_ICON = path.join(__dirname, "resources/app-icon.png");
let desktopViewerWindow = null;
let desktopViewerOwner = null;
let desktopViewerContextId = null;
let desktopWorkspaceManager = null;
let desktopWorkspaceOwner = null;
function appWindows() {
  return BrowserWindow.getAllWindows().filter((win) => !isTalkPanel(win));
}
let pendingPackageInstallUrl = packageUrlFromCommandLine(process.argv);
let pendingChatLink = chatLinkFromCommandLine(process.argv);
let mainWindow = null;
const serverUnavailableWindows = new WeakSet();
let unreadCount = 0;
let unreadOverlayIcon = null;

const windowStateFile = createWindowStateFile({ file: () => path.join(app.getPath("userData"), "window-state.json"), log: message => slog(message) });

function applyUnreadBadge(win = mainWindow) {
  const count = normalizeUnreadCount(unreadCount);
  if (process.platform === "win32") {
    if (!win || win.isDestroyed()) return;
    unreadOverlayIcon ??= nativeImage.createFromPath(APP_ICON).resize({ width: 16, height: 16 });
    win.setOverlayIcon(
      count > 0 && !unreadOverlayIcon.isEmpty() ? unreadOverlayIcon : null,
      count > 0 ? `${count} unread conversation${count === 1 ? "" : "s"}` : "No unread conversations",
    );
    return;
  }
  if (process.platform === "darwin" || process.platform === "linux") app.setBadgeCount(count);
}

// GNOME groups the window with its desktop entry only when both identities match; set before ready.
if (process.platform === "linux") {
  if (linuxDisablesGpu()) app.disableHardwareAcceleration();
  app.setDesktopName("com.openpals.app.desktop");
}

if (!app.requestSingleInstanceLock()) {
  console.log("[desktop] Openpals is already running — focusing that window");
  process.exit(0);
}

/** To this computer's page only: while the window shows a server, the link waits. */
function sendToPage(win, channel, value) {
  if (!win || win.isDestroyed() || win.webContents.isLoadingMainFrame()) return false;
  let shown = null;
  try { shown = new URL(win.webContents.getURL()).origin; } catch {}
  if (shown !== rendererOrigin()) return false;
  win.webContents.send(channel, value);
  return true;
}

function deliverPackageInstall(win = mainWindow) {
  if (pendingPackageInstallUrl && sendToPage(win, "package:install", pendingPackageInstallUrl)) pendingPackageInstallUrl = null;
}

function deliverChatLink(win = mainWindow) {
  if (pendingChatLink && sendToPage(win, "chat:open", pendingChatLink)) pendingChatLink = null;
}

let openWindowForLink = null;

/** macOS open-url does not fire activate, so a link that finds no window opens one. */
function revealForLink() {
  if (desktopTray?.show()) return;
  const appWindow = !startupScreen && mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : appWindows();
  if (activateExistingWindow(appWindow)) return;
  openWindowForLink?.();
}

function queuePackageInstall(rawLink) {
  const packageUrl = packageUrlFromDeepLink(rawLink);
  if (!packageUrl) return false;
  pendingPackageInstallUrl = packageUrl;
  revealForLink();
  deliverPackageInstall();
  return true;
}

function queueChatLink(rawLink) {
  const link = chatLinkFrom(rawLink);
  if (!link) return false;
  pendingChatLink = link;
  revealForLink();
  deliverChatLink();
  return true;
}

app.on("open-url", (event, url) => {
  if (!queuePackageInstall(url) && !queueChatLink(url)) return;
  event.preventDefault();
});

app.on("second-instance", (_event, commandLine) => {
  const packageUrl = packageUrlFromCommandLine(commandLine);
  if (packageUrl) pendingPackageInstallUrl = packageUrl;
  const chatLink = chatLinkFromCommandLine(commandLine);
  if (chatLink) pendingChatLink = chatLink;
  revealForLink();
  deliverPackageInstall();
  deliverChatLink();
});

let serverProc = null;
let serverReady = !app.isPackaged;
let secureCredentials = {};
let secureCredentialState = null;
let desktopDataDirLease = null;
let desktopPrefs = null, windowFrameMade = null;
const utilityServerExits = new WeakMap();
const UTILITY_SERVER_STOP_TIMEOUT_MS = 6_500;
const trustedApprovalMode = createTrustedApprovalModeCoordinator({ randomId: randomUUID });
const desktopMutationToken = randomBytes(32).toString("base64url");
const desktopLaunchId = randomUUID();
const companionMutationToken = randomBytes(32).toString("base64url");
const serverSupervisor = createServerSupervisor({
  restart: () => startServerOn(SERVER_PORT),
  stop: stopUtilityServer,
  onReady(proc) {
    serverProc = proc;
    serverReady = true;
    serverStartConflictOnly = false;
    slog(`server ready pid=${proc.pid} port=${SERVER_PORT}`);
    reportOwnListeners(proc);
    routineWake.start();
    for (const win of appWindows()) {
      if (!serverUnavailableWindows.has(win) || activeServer(placeState)) continue;
      void win.loadURL(`http://127.0.0.1:${SERVER_PORT}`).then(() => {
        serverUnavailableWindows.delete(win);
      }).catch((error) => {
        slog(`recovered server window failed to load: ${error?.message ?? error}`);
      });
    }
  },
  onUnavailable() {
    serverReady = false;
    serverProc = null;
    routineWake.stop();
  },
  onExhausted() {
    slog("server recovery paused after repeated failures; quit and reopen to retry");
    dialog.showErrorBox(
      "The bot server stopped",
      "Automatic recovery could not restart the background server. Quit and reopen Openpals to try again. Interrupted chat turns were not resent.\n\n" +
        `Server log: ${path.join(LOG_DIR, "server.log")}`,
    );
  },
  log: slog,
});

function desktopDataDir() {
  // An empty OMB_DATA_DIR falls back here too; server/config.ts would not, so the child gets this path.
  return process.env.OMB_DATA_DIR || path.join(app.getPath("home"), ".openmausbot");
}

async function stopUtilityServer(proc, timeoutMs = UTILITY_SERVER_STOP_TIMEOUT_MS) {
  if (!proc) return true;
  const exited = utilityServerExits.get(proc);
  if (!exited) return false;
  try {
    proc.kill();
  } catch {
  }
  let timer;
  return Promise.race([
    exited.then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}
let phoneSecretIdentity = null;

const CREDENTIALS_FILE = path.join(app.getPath("userData"), "credentials.bin");

/** True when the store could not be read, which is not the same as nothing saved. */
let credentialStoreUnavailable = false;

async function loadSecureCredentials() {
  const result = await readSecureCredentials({
    exists: () => fs.existsSync(CREDENTIALS_FILE),
    isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    readFile: () => fs.readFileSync(CREDENTIALS_FILE),
    decrypt: (buffer) => safeStorage.decryptStringAsync(buffer),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  credentialStoreUnavailable = result.status === "unavailable";
  if (credentialStoreUnavailable) {
    slog(`credential store unreadable after retries (${result.error}); saved keys are not loaded this launch`);
  }
  return result.credentials;
}

async function saveSecureCredentials(credentials) {
  // Writing from an unread store would drop the secrets it could not read.
  if (credentialStoreUnavailable) {
    throw new Error("The operating-system credential store could not be read this launch");
  }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("The operating-system credential store is unavailable");
  }
  fs.mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true });
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(credentials));
  const temporary = `${CREDENTIALS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
  fs.renameSync(temporary, CREDENTIALS_FILE);
}

async function secureComposioConfig() {
  const dataDir = desktopDataDir();
  const configPath = path.join(dataDir, "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!config?.composio || typeof config.composio !== "object") return;
    let changed = false;
    const apiKey = config?.composio?.apiKey;
    if (typeof apiKey === "string" && apiKey.trim().startsWith("ak_")) {
      if (!secureCredentials.composioApiKey) {
        secureCredentials.composioApiKey = apiKey.trim();
        await saveSecureCredentials(secureCredentials);
      }
      config.composio.apiKey = "";
      changed = true;
    } else if (typeof apiKey === "string" && apiKey.trim()) {
      config.composio.apiKey = "";
      changed = true;
    }
    // Unread legacy fields, removed so an unused secret is not left in plaintext.
    for (const field of ["key", "url"]) {
      if (Object.hasOwn(config.composio, field)) {
        delete config.composio[field];
        changed = true;
      }
    }
    if (!changed) return;
    const temporary = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, configPath);
  } catch (error) {
    if (error?.code !== "ENOENT") slog(`credential migration failed: ${error?.message ?? error}`);
  }
}

async function secureWorkspaceConfig() {
  const dataDir = desktopDataDir();
  const configPath = path.join(dataDir, "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const migrated = migrateWorkspaceCredentials(config, secureCredentials);
    // credentials.bin first, so a failed save never loses the only copy of a secret.
    if (migrated.credentialsChanged) await saveSecureCredentials(migrated.credentials);
    secureCredentials = migrated.credentials;
    if (!migrated.configChanged) return;
    const temporary = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(migrated.config, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, configPath);
  } catch (error) {
    if (error?.code !== "ENOENT") slog(`credential migration failed: ${error?.message ?? error}`);
  }
}

// Finder/Explorer launches have no usable stdio, so the server child's output goes to server.log here.
const LOG_DIR = app.getPath("logs");
const DESKTOP_CRASH_LOG = path.join(LOG_DIR, "desktop-crashes.log");
const DESKTOP_CRASH_LOG_MAX_BYTES = 512 * 1024;
let logStream = null;
let desktopShutdownStarted = false;
import {
  companionEnabledAtRest,
  companionPairing,
  companionRefreshTailscale,
  companionCloudDesktopAccess,
  companionBrowserControlAccess,
  companionRevoke,
  companionRunning,
  companionState,
  rememberCompanionEnabled,
  rememberCompanionKeepAwake,
  setCompanionLifecycleListener,
  startCompanion,
  stopCompanion,
} from "./companion.mjs";
import { autoStartCompanion } from "./companion-autostart.mjs";
import { createRoutineWakeHold, rememberRoutineWake, routineWakeSettings } from "./routine-wake.mjs";
import { CREDENTIAL_PATCH, credentialSaveError } from "./credential-patch.mjs";

/** Second wall after preload's reduced bridge: computer-controlling IPC answers only the local server's UI.
 * Declared before any handler registration (temporal dead zone). */
const { isLocalSender: senderIsLocal, localOnly, localOnlySync, setLocalOrigin } = localOriginModule;

let companionPowerBlocker = null;

function syncCompanionKeepAwake(companionEnabled, keepAwake) {
  const shouldBlock = companionEnabled && keepAwake;
  if (shouldBlock && companionPowerBlocker === null) {
    companionPowerBlocker = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!shouldBlock && companionPowerBlocker !== null) {
    if (powerSaveBlocker.isStarted(companionPowerBlocker)) powerSaveBlocker.stop(companionPowerBlocker);
    companionPowerBlocker = null;
  }
}

const routineWake = createRoutineWakeHold({
  fetchStatus: () => (serverReady
    ? fetch(`http://127.0.0.1:${SERVER_PORT}/api/routines/wake`, { signal: AbortSignal.timeout(5_000), redirect: "error", credentials: "omit" })
      .then((response) => (response.ok ? response.json() : null))
    : Promise.resolve(null)),
  isOnBattery: () => {
    try {
      return powerMonitor.isOnBatteryPower();
    } catch {
      return false;
    }
  },
  blocker: powerSaveBlocker,
  settings: () => routineWakeSettings(app.getPath("userData")),
  log: (line) => slog(line),
});

function slog(line) {
  try {
    if (!logStream) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      logStream = fs.createWriteStream(path.join(LOG_DIR, "server.log"), { flags: "a" });
    }
    logStream.write(`[${new Date().toISOString()}] ${line}\n`);
  } catch {
  }
}

// Synchronous: a fatal exception can end Electron before an async write flushes.
// uncaughtExceptionMonitor observes Node's fatal path without handling it, so the process still exits.
installDesktopCrashListeners({
  appTarget: app,
  processTarget: process,
  record: (event) => appendDesktopCrashRecord(DESKTOP_CRASH_LOG, DESKTOP_CRASH_LOG_MAX_BYTES, formatDesktopCrashRecord(event)),
  isShuttingDown: () => desktopShutdownStarted,
  mainWebContents: () => mainWindow?.webContents ?? null,
});

/** Every credential writer goes through this one serialized hook, so concurrent saves never overwrite each other. */
export async function updateSecureCredentialDocument(derive, afterPersist) {
  if (!secureCredentialState) throw new Error("Secure credentials are not ready");
  try {
    return await secureCredentialState.update(derive, afterPersist);
  } finally {
    secureCredentials = secureCredentialState.read();
  }
}

async function ensurePhoneSecretIdentity() {
  const existing = readPhoneSecretIdentity(secureCredentialState?.read() ?? secureCredentials);
  if (existing) {
    phoneSecretIdentity = existing;
    return existing;
  }
  try {
    const created = await createPhoneSecretIdentity();
    await updateSecureCredentialDocument((credentials) =>
      withPhoneSecretIdentity(credentials, created),
    );
    phoneSecretIdentity = created;
    return created;
  } catch (error) {
    phoneSecretIdentity = null;
    slog(`phone credential key unavailable: ${error?.message ?? error}`);
    return null;
  }
}

function decorateDesktopCompanionState(state) {
  syncCompanionKeepAwake(state.enabled && !state.error, state.keepAwake === true);
  return state;
}

async function desktopCompanionState() {
  return decorateDesktopCompanionState(await companionState());
}

function companionLaunchOptions() {
  return {
    resourcesPath: process.resourcesPath,
    harnessPort: SERVER_PORT,
    mutationToken: companionMutationToken,
    // Only an embedded server receives the private half; a dev server must not advertise the public key.
    secretPublicKey: app.isPackaged && serverProc ? phoneSecretIdentity?.publicKey ?? null : null,
    log: slog,
  };
}

async function startDesktopCompanion({ remember = true } = {}) {
  const localState = await startCompanion(companionLaunchOptions());
  if (localState.enabled && !localState.error && remember) rememberCompanionEnabled(true);
  return desktopCompanionState();
}

async function stopDesktopCompanion({ remember = true } = {}) {
  if (remember) rememberCompanionEnabled(false);
  syncCompanionKeepAwake(false, false);
  await stopCompanion();
  return desktopCompanionState();
}

async function refreshDesktopCompanionTailscale() {
  if (!companionRunning()) {
    const started = await startDesktopCompanion();
    if (!started.enabled || started.error) return started;
  }
  return decorateDesktopCompanionState(await companionRefreshTailscale());
}

setCompanionLifecycleListener(({ expected, pid }) => {
  if (expected) return;
  slog(`owned companion exited unexpectedly pid=${pid ?? "unknown"}`);
  syncCompanionKeepAwake(false, false);
});

// Everything the bug-report bundle needs: config is booleans only and the log is redacted, since it is pasted into public issues.
async function gatherDiagnostics() {
  const serverStatus = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/config`, {
    signal: AbortSignal.timeout(3_000),
  })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  const logPath = path.join(LOG_DIR, "server.log");
  const log = readSafeLogTail(logPath);
  const desktopLog = readSafeLogTail(DESKTOP_CRASH_LOG);
  return buildDiagnosticsReport({
    appInfo: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      packaged: app.isPackaged,
      uptimeSeconds: Math.round(process.uptime()),
    },
    configSummary: serverStatus ?? {},
    desktopLogTail: desktopLog?.tail ?? "",
    logTail: log?.tail ?? "",
  });
}

let serverStartConflictOnly = false;

function syncPhoneSecretKey(proc) {
  const message = phoneSecretPrivateKeyMessage(phoneSecretIdentity);
  if (!message) return;
  try {
    proc.postMessage(message);
  } catch (error) {
    slog(`phone credential key sync failed: ${error?.message ?? error}`);
  }
}

function syncDesktopMutationToken(proc) {
  try {
    proc.postMessage({
      type: "openmausbot:desktop-mutation-token",
      token: desktopMutationToken,
      companionToken: companionMutationToken,
    });
  } catch (error) {
    slog(`desktop mutation capability sync failed: ${error?.message ?? error}`);
  }
}

const savePhoneSecretOnce = createPhoneSecretSaveCoordinator((target, value) =>
  saveWorkspaceCredential(target, value),
);

function receivePhoneSecretSave(proc, rawMessage) {
  const request = decodePhoneSecretSaveRequest(rawMessage);
  if (!request) return false;
  void savePhoneSecretOnce(request).then((result) => {
    try {
      proc.postMessage(result);
    } catch (error) {
      slog(`phone credential save result failed: ${error?.message ?? error}`);
    }
  });
  return true;
}

async function startServerOn(port) {
  if (desktopShutdownStarted) return { proc: null, abort: true };
  const { entry, compileCacheDir } = serverChildLaunch({
    resourcesPath: process.resourcesPath,
    userData: app.getPath("userData"),
  });
  const childEnv = {
    ...process.env,
    // The parent owns the data-dir lease; a child only validates it, so fallback-port children never replace it.
    ...desktopDataDirLease.utilityServerLeaseEnvironment(),
    OMB_DATA_DIR: desktopDataDir(),
    // Fail-closed until this process sends the private connection; never a descriptor inherited from the shell.
    OMB_DESKTOP_PARENT: "1",
    OMB_DESKTOP_LAUNCH_ID: desktopLaunchId,
    OMB_STATIC_DIR: path.join(process.resourcesPath, "ui"),
    OMB_RESOURCES_PATH: process.resourcesPath,
    OMB_SKILLS_DIR: path.join(process.resourcesPath, "skills"),
    OMB_PORT: String(port),
    OMB_APP_VERSION: app.getVersion(),
    OMB_USER_DATA: app.getPath("userData"),
    ...(secureCredentials.composioApiKey
      ? { COMPOSIO_API_KEY: secureCredentials.composioApiKey }
      : {}),
    OMB_CREDENTIAL_STORE: credentialStoreUnavailable ? "unavailable" : "ok",
    ...workspaceCredentialEnv(secureCredentials),
  };
  delete childEnv.OMB_BROWSER_CONNECTION;
  delete childEnv.OMB_SERVER_COMPILE_CACHE;
  if (compileCacheDir) childEnv.OMB_SERVER_COMPILE_CACHE = compileCacheDir;
  slog(`fork ${entry} port=${port}`);
  const proc = utilityProcess.fork(entry, [], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let resolveServerExit;
  utilityServerExits.set(proc, new Promise((resolve) => {
    resolveServerExit = resolve;
  }));
  const listening = listeningSignal();
  proc.stdout?.on("data", (d) => {
    listening.hear(String(d));
    slog(`[out] ${String(d).trimEnd()}`);
  });
  proc.stderr?.on("data", (d) => slog(`[err] ${String(d).trimEnd()}`));
  proc.on("message", (message) => {
    if (!serverSupervisor.isCurrent(proc)) return;
    try {
      if (trustedApprovalMode.receive(proc, message)) return;
      receivePhoneSecretSave(proc, message);
    } catch (error) {
      slog(`desktop private sync rejected: ${error?.message ?? error}`);
    }
  });
  proc.once("spawn", () => {
    slog(`spawned pid=${proc.pid}`);
    if (!serverSupervisor.isCurrent(proc)) return;
    syncDesktopMutationToken(proc);
    syncPhoneSecretKey(proc); grantLocalComputer(proc, (child) => serverSupervisor.isCurrent(child));
  });
  let exited = false;
  proc.once("exit", (code) => {
    exited = true;
    trustedApprovalMode.rejectProcess(proc);
    resolveServerExit();
    slog(`exited code=${code}`);
  });
  serverSupervisor.watch(proc);
  const identity = await pollServerIdentity({
    port,
    pid: () => proc.pid,
    bootTimeoutMs: SERVER_BOOT_TIMEOUT_MS,
    isExited: () => exited || desktopShutdownStarted,
    isListening: listening.heard,
    listeningGraceMs: SERVER_LISTENING_GRACE_MS,
  });
  if (identity.outcome === "ready" && serverSupervisor.isCurrent(proc)) return { proc };
  slog(bootFailureMessage(port, identity));
  const stopped = await stopUtilityServer(proc);
  if (!stopped) {
    slog(`child on port ${port} did not exit after termination; refusing to start a sibling server`);
  }
  return { proc: null, reason: stopped ? identity.outcome : "stuck-child", abort: !stopped };
}

async function startServerPackaged() {
  let everyPortForeignOwned = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const port of DESKTOP_PORTS) {
      if (desktopShutdownStarted) return false;
      const started = await startServerOn(port);
      if (started.proc) {
        SERVER_PORT = port;
        if (serverSupervisor.ready(started.proc)) return true;
      }
      if (started.abort) return false;
      if (started.reason !== "foreign-owner") everyPortForeignOwned = false;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  serverStartConflictOnly = everyPortForeignOwned;
  return false;
}

let cuaReady = Promise.resolve({ mode: "unavailable", reason: "not-started" });
const androidDevice = createAndroidDeviceController({ resourcesPath: process.resourcesPath });
const displayMediaGuard = createDisplayMediaGuard();
let displayMediaRequestCount = 0;

function rendererOrigin() {
  return new URL(app.isPackaged ? `http://127.0.0.1:${SERVER_PORT}` : DEV_URL).origin;
}

function respondToDisplayMediaRequest(callback, response) {
  const error = invokeDisplayMediaCallback(callback, response);
  if (error && response.video) {
    console.error("[screen-preview] failed to deliver selected source:", error);
  }
}

function notifyDesktopViewer(open) {
  if (!desktopViewerOwner?.isDestroyed()) {
    desktopViewerOwner.send("desktop-viewer:state", {
      open,
      contextId: desktopViewerContextId,
    });
  }
}

function openDesktopViewer(owner, rawUrl, rawTitle, contextId) {
  if (!owner || owner.isDestroyed()) throw new Error("The Openpals window is unavailable");
  const url = desktopViewerUrl(rawUrl);
  const titleCandidate = Object.prototype.toString.call(rawTitle) === "[object String]" ? rawTitle.trim() : "";
  const title = titleCandidate ? titleCandidate.slice(0, 80) : "Live desktop";

  const nextContextId =
    Object.prototype.toString.call(contextId) === "[object String]" ? contextId.slice(0, 120) : null;

  // Clear the ref first so the stale window's close handler no-ops; a token-bearing URL is never retained.
  if (desktopViewerWindow && !desktopViewerWindow.isDestroyed()) {
    const previous = desktopViewerWindow;
    const previousOwner = desktopViewerOwner;
    const previousContextId = desktopViewerContextId;
    desktopViewerWindow = null;
    previous.close();
    if (previousContextId !== nextContextId && previousOwner && !previousOwner.isDestroyed()) {
      previousOwner.send("desktop-viewer:state", { open: false, contextId: previousContextId });
    }
  }
  desktopViewerOwner = owner.webContents;
  desktopViewerContextId = nextContextId;

  const viewer = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    parent: owner,
    modal: false,
    show: false,
    title,
    icon: APP_ICON,
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Non-persistent partition: provider cookies stay out of the app renderer and die on exit.
      partition: "openmausbot-desktop-viewer",
    },
  });
  desktopViewerWindow = viewer;
  const viewerOrigin = url.origin;

  viewer.webContents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    desktopViewerPermissionAllowed(permission, requestingOrigin, viewerOrigin),
  );
  viewer.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(desktopViewerPermissionAllowed(permission, details?.requestingUrl || webContents.getURL(), viewerOrigin)),
  );

  // A child window gets keystrokes only once focused; unfocused, typing lands in the app's composer.
  viewer.once("ready-to-show", () => {
    if (viewer.isDestroyed()) return;
    viewer.show();
    viewer.focus();
    viewer.webContents.focus();
  });
  viewer.on("closed", () => {
    if (desktopViewerWindow !== viewer) return;
    desktopViewerWindow = null;
    notifyDesktopViewer(false);
    desktopViewerOwner = null;
    desktopViewerContextId = null;
  });
  viewer.on("page-title-updated", (event) => {
    event.preventDefault();
    viewer.setTitle(title);
  });
  viewer.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const external = desktopViewerUrl(target);
      void shell.openExternal(external.toString());
    } catch {
    }
    return { action: "deny" };
  });
  viewer.webContents.on("will-navigate", (event, target) => {
    if (sameDesktopViewerOrigin(target, viewerOrigin)) return;
    event.preventDefault();
    try {
      void shell.openExternal(desktopViewerUrl(target).toString());
    } catch {
    }
  });
  viewer.webContents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 || viewer.isDestroyed() || failedUrl.startsWith("data:")) return;
    void viewer.loadURL(desktopViewerErrorPage(description || "The viewer did not respond.", url.toString()));
  });

  notifyDesktopViewer(true);
  void viewer.loadURL(url.toString()).catch((error) => {
    if (viewer.isDestroyed()) return;
    void viewer.loadURL(desktopViewerErrorPage(error?.message ?? "The viewer did not respond.", url.toString()));
  });
  return true;
}

function ensureDesktopWorkspace(owner) {
  if (!owner || owner.isDestroyed()) throw new Error("The Openpals window is unavailable");
  if (desktopWorkspaceManager) {
    if (desktopWorkspaceOwner !== owner) {
      throw new Error("The two-desktop view belongs to another app window");
    }
    return desktopWorkspaceManager;
  }

  desktopWorkspaceOwner = owner;
  const manager = createDesktopWorkspaceManager({
    owner,
    createView: (options) => new WebContentsView(options),
    partitionPrefix: `openmausbot-desktop-workspace-${randomUUID()}`,
    notify: (state) => {
      if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) {
        owner.webContents.send("desktop-workspace:state", state);
      }
    },
  });
  desktopWorkspaceManager = manager;

  // Native child views outlive the renderer DOM; close both panes so no secret-bearing noVNC URL survives.
  owner.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) manager.closeAll();
  });
  owner.webContents.on("render-process-gone", () => manager.closeAll());
  owner.once("closed", () => {
    manager.closeAll();
    if (desktopWorkspaceManager === manager) {
      desktopWorkspaceManager = null;
      desktopWorkspaceOwner = null;
    }
  });
  return manager;
}

function desktopWorkspaceForEvent(event, create = false) {
  const owner = mainWindow;
  if (!owner || owner.isDestroyed() || event.sender !== owner.webContents) {
    throw new Error("The two-desktop view is available only to the main app window");
  }
  if (desktopWorkspaceManager && desktopWorkspaceOwner !== owner) {
    throw new Error("The two-desktop view belongs to another app window");
  }
  return create ? ensureDesktopWorkspace(owner) : desktopWorkspaceManager;
}

ipcMain.on("screen:preview-intent", localOnlySync("screen:preview-intent", (event) => {
  event.returnValue = displayMediaGuard.begin(event.senderFrame);
}));

ipcMain.on("desktop:unread-count", (event, value) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!sender || sender !== mainWindow || sender.isDestroyed()) return;
  unreadCount = normalizeUnreadCount(value);
  applyUnreadBadge(sender);
});

const { LOCAL_PLACE, activeServer, guardedOrigins, parseHostedWorkspaceLink, placeView, withMicrophone, withServer, workspaceNavigationAllowed, workspaceSenderAllowed, workspaceWindowTitle } = environmentsModule;
let placeState = LOCAL_PLACE;
const placeFile = createPlaceFile({ file: () => path.join(app.getPath("userData"), "environments.json"), fs, path, log: slog });

const loginItem = createOpenAtLogin({ app, home: os.homedir() });
installOpenAtLogin({ ipcMain, guard: localOnly, loginItem, changed: refreshApplicationMenu });

function refreshApplicationMenu() {
  Menu.setApplicationMenu(
    buildApplicationMenu({
      server: activeServer(placeState),
      onConnectFromClipboard: () => void menuAction(connectFromClipboard),
      onDisconnect: () => void menuAction(disconnectFromMenu),
      onOpenSettings: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:open-settings"); },
      openAtLogin: loginItem.available() ? { checked: loginItem.chosen(), onToggle: on => { loginItem.choose(on); refreshApplicationMenu(); } } : null,
    }),
  );
}

async function menuAction(action) {
  try { await action(); } catch (error) {
    await dialog.showMessageBox({ type: "error", message: "Could not update the server connection", detail: error.message });
  }
}

function showMessage(options) {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

/** Where the bots live, saved, and told to the window's page. */
function savePlace(next) {
  placeFile.write(next);
  placeState = next;
  refreshApplicationMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(workspaceWindowTitle(placeState));
    mainWindow.webContents.send("place:changed", placeView(placeState));
  }
}

function navigateMainWindow(url) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(false);
  return mainWindow.loadURL(url).then(() => true, () => false);
}

/** Security: a page asks to connect, but the person confirms the destination here, in a native dialog. */
async function connectServer(input) {
  const link = parseHostedWorkspaceLink(input);
  if (!link) {
    return { ok: false, error: "Enter an HTTPS server address or a full pairing link. Keep the pairing code after #, not in the URL query." };
  }
  const { response } = await showMessage({
    type: "question",
    buttons: ["Connect", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    message: `Connect to ${new URL(link.origin).host}?`,
    detail: link.code
      ? "The pairing code in the link is used once, then this app stays signed in to that server."
      : "The link has no pairing code; the server will ask for one.",
  });
  if (response !== 0) return { ok: false, error: "cancelled" };
  return openServer(link);
}

/** Security: `link` is one the person confirmed, or one this app got from a server it set up for them. */
async function openServer(link) {
  if (!(await serverAnswers(link.origin))) return { ok: false, error: "unreachable" };
  const previous = activeServer(placeState);
  try {
    savePlace(withServer(placeState, { origin: link.origin }));
  } catch (error) {
    return { ok: false, error: error.message };
  }
  void navigateMainWindow(link.url);
  if (previous && previous.origin !== link.origin) void forgetServer(previous);
  return { ok: true };
}

/** Asked only after the person confirmed the destination, so a page cannot make this app probe addresses. */
async function serverAnswers(origin) {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(10_000) });
    const body = await response.json();
    return response.ok && body?.app === "openmausbot";
  } catch {
    return false;
  }
}

async function connectFromClipboard() {
  const result = await connectServer(clipboard.readText());
  if (!result.ok && result.error !== "cancelled") {
    const detail = result.error === "unreachable" ? "The server didn't answer. Check that it is running and that its HTTPS address is right." : result.error;
    await dialog.showMessageBox({ type: "info", message: "Could not connect to the server", detail });
  }
}

async function disconnectServer() {
  const server = activeServer(placeState);
  if (!server) return;
  savePlace(LOCAL_PLACE);
  void navigateMainWindow(rendererOrigin());
  await forgetServer(server);
}

async function disconnectFromMenu() {
  const server = activeServer(placeState);
  if (!server) return;
  const { response } = await showMessage({
    type: "warning",
    buttons: ["Disconnect", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: `Disconnect from “${server.name}”?`,
    detail: "This app signs out of that server and shows this computer's bots. The server keeps its own session list; revoke it there too if the device is gone.",
  });
  if (response === 0) await disconnectServer();
}

/** Signs this app out of a server it no longer shows. Chromium keeps cookies per host, not per port: a host this app
 * still shows keeps its cookies. */
async function forgetServer(server) {
  remoteMicrophoneRefused.delete(server.origin);
  try {
    const response = await session.defaultSession.fetch(`${server.origin}/api/auth/logout`, { method: "POST", credentials: "include", headers: { origin: server.origin }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    slog(`forget server: logout skipped (${error?.message ?? error})`);
  }
  const host = new URL(server.origin).hostname;
  const hostInUse = [rendererOrigin(), activeServer(placeState)?.origin].some((origin) => origin && new URL(origin).hostname === host);
  try {
    await session.defaultSession.clearStorageData({
      origin: server.origin,
      storages: [...(hostInUse ? [] : ["cookies"]), "localstorage", "indexdb", "serviceworkers", "cachestorage"],
    });
  } catch (error) {
    slog(`forget server: storage clear failed: ${error?.message ?? error}`);
  }
}

let unreachableAsked = false;
async function serverUnreachable(server, description) {
  if (unreachableAsked) return;
  unreachableAsked = true;
  try {
    const { response } = await showMessage({
      type: "warning",
      buttons: ["Try again", "Disconnect"],
      defaultId: 0,
      cancelId: 0,
      message: `${server.name} isn't answering`,
      detail: `${description}. Try again once it is back, or disconnect to use this computer's bots instead.`,
    });
    if (activeServer(placeState)?.origin !== server.origin) return;
    if (response === 1) await disconnectServer();
    else void navigateMainWindow(server.origin);
  } finally {
    unreachableAsked = false;
  }
}

// Per-server microphone consent; "Don't Allow" holds until quit or disconnect, so a page cannot keep re-asking.
const remoteMicrophoneAsks = new Map();
const remoteMicrophoneRefused = new Set();
function askRemoteMicrophone(origin) {
  const server = activeServer(placeState);
  if (!server || server.origin !== origin || server.microphone === true || remoteMicrophoneRefused.has(origin)) return null;
  if (!remoteMicrophoneAsks.has(origin)) {
    const ask = (async () => {
      const { response } = await showMessage({
        type: "question",
        buttons: ["Allow", "Don’t Allow"],
        defaultId: 1,
        cancelId: 1,
        message: `Allow “${server.name}” to use the microphone?`,
        detail: `${new URL(origin).host} wants to hear you for a Live call. Allow only a server you trust; this app remembers your answer for this server until you disconnect from it.`,
      });
      if (response !== 0) return void remoteMicrophoneRefused.add(origin);
      if (activeServer(placeState)?.origin === origin) savePlace(withMicrophone(placeState));
    })().finally(() => remoteMicrophoneAsks.delete(origin));
    remoteMicrophoneAsks.set(origin, ask);
  }
  return remoteMicrophoneAsks.get(origin);
}

function showContextMenu(win, params) {
  if (!params.isEditable && !params.linkURL && !params.misspelledWord && !params.selectionText) return;
  const menuItems = [];
  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      menuItems.push({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion),
      });
    }
    if (menuItems.length) menuItems.push({ type: "separator" });
  }
  if (params.linkURL) {
    menuItems.push(
      { label: "Copy Link", click: () => clipboard.writeText(params.linkURL) },
      { type: "separator" },
    );
  }
  menuItems.push(
    { label: "Undo", role: "undo", enabled: params.editFlags.canUndo },
    { label: "Redo", role: "redo", enabled: params.editFlags.canRedo },
    { type: "separator" },
    { label: "Cut", role: "cut", enabled: params.editFlags.canCut },
    { label: "Copy", role: "copy", enabled: params.editFlags.canCopy },
    pasteMenuItem(params, clipboard, win.webContents),
    { label: "Paste and Match Style", role: "pasteAndMatchStyle", enabled: params.editFlags.canPaste },
    { type: "separator" },
    { label: "Select All", role: "selectAll", enabled: params.editFlags.canSelectAll },
  );
  Menu.buildFromTemplate(menuItems).popup({ window: win, frame: params.frame });
}

function createWindow() {
  const waitsForSkinSync = process.platform === "win32";
  const primary = screen.getPrimaryDisplay();
  const displays = [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)];
  const restored = resolveWindowState(windowStateFile.read(), displays.map((display) => display.workArea));
  const win = new BrowserWindow({
    ...restored.bounds,
    minWidth: MIN_BOUNDS.width,
    minHeight: MIN_BOUNDS.height,
    show: !waitsForSkinSync && !startupScreen,
    icon: APP_ICON,
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    autoHideMenuBar: process.platform !== "darwin",
    ...windowChromeOptions(process.platform, windowFrameMade = desktopPrefs?.windowFrame() !== false),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [`--omb-local-origin=${rendererOrigin()}`, `--omb-app-version=${app.getVersion()}`],
    },
  });
  mainWindow = win;
  win.on("show", () => desktopTray?.windowShown(win));
  win.on("close", (event) => {
    if (process.platform === "win32" && !desktopShutdownStarted && desktopTray) {
      event.preventDefault();
      desktopTray.hide(win);
    }
  });
  const title = () => workspaceWindowTitle(placeState);
  win.setTitle(title());
  win.webContents.on("page-title-updated", event => {
    if (!activeServer(placeState)) return;
    event.preventDefault();
    win.setTitle(title());
  });
  if (startupScreen) startupScreen.attach(win, { maximized: restored.maximized });
  else if (waitsForSkinSync) {
    const skinSyncFallback = setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    }, 5_000);
    skinSyncFallback.unref?.();
    const clearSkinSyncFallback = () => clearTimeout(skinSyncFallback);
    win.once("show", clearSkinSyncFallback);
    win.once("closed", clearSkinSyncFallback);
  }
  windowStateFile.install(win);
  applyUnreadBadge(win);
  if (restored.maximized && !startupScreen) win.maximize();
  win.once("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(externalLinkUrl(url)).catch(() => {
        console.warn("The external web link could not be opened");
      });
    } catch {
    }
    return { action: "deny" };
  });
  const guardNavigation = (event, url) => {
    let origin = null;
    try {
      origin = new URL(url).origin;
    } catch {}
    if (workspaceNavigationAllowed(url, placeState, rendererOrigin())) return;
    event.preventDefault();
    slog(`blocked navigation to ${origin ?? "an invalid address"}`);
  };
  win.webContents.on("will-navigate", guardNavigation);
  win.webContents.on("will-redirect", guardNavigation);
  // No page may embed the local server, or the server, in this preload-bearing window.
  win.webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return;
    if (!appFrameNavigationAllowed(details)) return void details.preventDefault();
    let target = null;
    let page = null;
    try {
      target = new URL(details.url).origin;
      page = new URL(win.webContents.getURL()).origin;
    } catch {}
    if (!target || !page || target === page) return;
    if (guardedOrigins(placeState, rendererOrigin()).has(target)) {
      details.preventDefault();
      slog(`blocked subframe navigation to ${details.url}`);
    }
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3: aborted by a newer navigation
    const server = activeServer(placeState);
    if (!server) return;
    let origin = null;
    try {
      origin = new URL(validatedURL).origin;
    } catch {}
    if (origin !== server.origin) return;
    slog(`server unreachable (${errorDescription})`);
    void serverUnreachable(server, errorDescription);
  });
  // Not did-finish-load: Electron still reports the main frame as loading then.
  win.webContents.on("did-stop-loading", () => {
    deliverPackageInstall(win);
    deliverChatLink(win);
  });

  // Electron has no default context menu.
  win.webContents.on("context-menu", (_event, params) => {
    showContextMenu(win, params);
  });

  if (process.env.OMB_SMOKE_TEST === "1") {
    win.webContents.once("did-finish-load", async () => {
      try {
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            if (!window.ogb?.getCapabilities) throw new Error("desktop preload bridge is unavailable");
            let crashPromise = null;
            if (${JSON.stringify(process.env.OMB_SMOKE_CUA === "1")}) {
              crashPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  unsubscribe?.();
                  reject(new Error("timed out waiting for CUA crash invalidation"));
                }, 10000);
                const unsubscribe = window.ogb.onCapabilitiesChanged((next) => {
                  if (next.localComputer.reasonCode !== "daemon-exited") return;
                  clearTimeout(timeout);
                  unsubscribe();
                  resolve(next.localComputer.reasonCode);
                });
              });
            }
            const [initialCapabilities, healthResponse, ownerMutationResponse] = await Promise.all([
              window.ogb.getCapabilities(),
              fetch("/api/health"),
              fetch("/api/auth/stream-ticket", { method: "POST" }),
            ]);
            if (!healthResponse.ok) {
              throw new Error(\`health request failed: \${healthResponse.status} \${healthResponse.statusText}\`);
            }
            const health = await healthResponse.json();
            if (!ownerMutationResponse.ok) {
              throw new Error(
                \`desktop mutation capability failed: \${ownerMutationResponse.status} \${ownerMutationResponse.statusText}\`,
              );
            }
            let capabilities = initialCapabilities;
            let cuaCrashReason = null;
            let cuaRetryStatus = null;
            if (crashPromise) {
              if (!initialCapabilities.localComputer.available) {
                throw new Error("CUA was not ready before the simulated crash");
              }
              cuaCrashReason = await crashPromise;
              cuaRetryStatus = await window.ogb.localControl.retry();
              capabilities = await window.ogb.getCapabilities();
            }
            return {
              initialCapabilities,
              capabilities,
              cuaCrashReason,
              cuaRetryStatus,
              health,
              location: window.location.href,
              title: document.title,
            };
          })()
        `);
        const expectedLocation = `http://127.0.0.1:${SERVER_PORT}/`;
        if (result.location !== expectedLocation) {
          throw new Error(
            `unexpected packaged renderer URL: ${result.location} (expected ${expectedLocation})`,
          );
        }
        if (process.env.OMB_SMOKE_BUNDLED_CUA === "1") {
          const connection = await cuaReady;
          const expectedDriver = path.join(
            process.resourcesPath,
            "cua-linux-x64",
            "cua-driver",
          );
          let exactBundledPath = false;
          try {
            exactBundledPath =
              Boolean(connection?.driver?.path) &&
              fs.realpathSync(connection.driver.path) === fs.realpathSync(expectedDriver);
          } catch {}
          result.cuaRuntime = {
            driverSource: connection?.driver?.source,
            exactBundledPath,
            appImagePrivateStage:
              Boolean(process.env.APPIMAGE) &&
              connection?.driver?.path !== expectedDriver &&
              path.basename(path.dirname(connection?.driver?.path ?? "")).startsWith(
                APPIMAGE_CUA_STAGE_PREFIX,
              ),
            driverPath: connection?.driver?.path,
            driverVersion: connection?.driver?.version,
            daemonPid: connection?.daemon?.pid,
            socketPath: connection?.daemon?.socketPath,
            pidFile: connection?.daemon?.socketPath
              ? path.join(path.dirname(connection.daemon.socketPath), "driver.pid")
              : undefined,
            mcpEnv: connection?.mcp?.env,
          };
        }
        result.hardwareAccelerationEnabled = app.isHardwareAccelerationEnabled();
        result.displayMediaRequests = displayMediaRequestCount;
        console.log(`[smoke] renderer-ready ${JSON.stringify(result)}`);
      } catch (error) {
        console.error(`[smoke] renderer-failed ${error?.stack ?? error}`);
      } finally {
        if (process.env.OMB_SMOKE_KEEP_OPEN !== "1") win.close();
      }
    });
  }

  const server = activeServer(placeState);
  if (!serverReady && app.isPackaged && !server) serverUnavailableWindows.add(win);
  if (server) {
    void win.loadURL(server.origin).catch(() => {});
  } else if (app.isPackaged) {
    win.loadURL(serverReady ? `http://127.0.0.1:${SERVER_PORT}` : buildErrorPage({ allPortsOccupied: serverStartConflictOnly, logDir: LOG_DIR }));
  } else {
    win.loadURL(DEV_URL);
  }
  return win;
}

// From main so macOS attributes the Screen Recording prompt to the app, not the server.
ipcMain.handle("screen:frame", localOnly("screen:frame", async () => {
  if (process.platform !== "darwin" && process.platform !== "win32") return null;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 800 },
  });
  return sources[0]?.thumbnail.toDataURL() ?? null;
}));

// Renderer-controlled text must never become a process argument: the user reviews and pastes it.
ipcMain.handle("engine:open-terminal", localOnly("engine:open-terminal", async (_event, command) => {
  if (typeof command !== "string" || !command.trim()) return false;
  clipboard.writeText(command);
  return openBlankTerminal();
}));

ipcMain.handle("clipboard:write-text", localOnly("clipboard:write-text", (_event, text) => writeClipboardText(clipboard, text)));

ipcMain.handle("desktop:pick-folder", localOnly("desktop:pick-folder", async (event, current) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const result = await dialog.showOpenDialog(win, {
    title: "Choose a working folder",
    properties: ["openDirectory", "createDirectory"],
    ...(typeof current === "string" && current ? { defaultPath: current } : {}),
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}));

// Secrets are never read, and the report is redacted again on the way out.
ipcMain.handle("desktop:export-diagnostics", localOnly("desktop:export-diagnostics", async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const report = await gatherDiagnostics();
  const result = await dialog.showSaveDialog(owner, {
    title: "Export diagnostics",
    defaultPath: diagnosticsFileName(),
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (result.canceled || !result.filePath) return null;
  if (process.platform === "win32") {
    fs.writeFileSync(result.filePath, report, { mode: 0o600 });
  } else {
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
    const handle = fs.openSync(result.filePath, flags, 0o600);
    try {
      fs.fchmodSync(handle, 0o600);
      fs.writeFileSync(handle, report, "utf8");
    } finally {
      fs.closeSync(handle);
    }
  }
  return result.filePath;
}));

// The path is renderer-controlled: it must resolve inside ~/.openmausbot to a regular file, never a symlink escape.
ipcMain.handle("desktop:save-file", localOnly("desktop:save-file", async (event, rawPath) => {
  return withSavableFile(rawPath, { home: os.homedir() }, async ({ defaultName, copyTo }) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = await defaultSaveName(app.getPath("downloads"), defaultName);
    const choice = await dialog.showSaveDialog(parent ?? undefined, {
      title: "Where do you want to save it?",
      message: "Where do you want to save it?",
      defaultPath,
      buttonLabel: "Save",
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (choice.canceled || !choice.filePath) return null;
    await copyTo(choice.filePath);
    shell.showItemInFolder(choice.filePath);
    return choice.filePath;
  });
}));
ipcMain.handle("desktop:reveal-file", localOnly("desktop:reveal-file", async (_event, rawPath) => {
  return revealInFolder(rawPath, { reveal: (target) => shell.showItemInFolder(target) });
}));
ipcMain.handle("desktop:open-html", localOnly("desktop:open-html", (_event, source, name) => openHtmlCopy(source, name, { dir: path.join(app.getPath("userData"), "open-html"), open: (file) => shell.openPath(file) })));
ipcMain.handle("desktop:open-logs", localOnly("desktop:open-logs", () => openLogsFolder(LOG_DIR, { open: (folder) => shell.openPath(folder) })));
ipcMain.handle("desktop:skin", (event, skin) => {
  if (!isKnownSkin(skin)) return false;
  try {
    talk.skin(skin); const { color } = skinChrome(skin);
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (win && !win.isDestroyed()) {
      try { win.setBackgroundColor(color); } catch {}
    }
  } catch {}
  return true;
});

for (const [channel, act] of [
  ["window:minimize", (win) => win.minimize()],
  ["window:toggle-maximize", (win) => (win.isMaximized() ? win.unmaximize() : win.maximize())],
  ["window:close", (win) => win.close()],
]) {
  ipcMain.handle(channel, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win || win.isDestroyed()) return false;
    act(win);
    return true;
  });
}
ipcMain.handle("window:state", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  return { maximized: Boolean(win && !win.isDestroyed() && win.isMaximized()) };
});

// Links resolved after Chromium's click gesture ended would be blocked as popups via window.open.
ipcMain.handle("desktop:open-external", localOnly("desktop:open-external", async (_event, rawUrl) => {
  await shell.openExternal(externalLinkUrl(rawUrl));
  return true;
}));

// The Boat VNC viewer must be a top-level page for its token exchange.
ipcMain.handle("desktop-viewer:open", localOnly("desktop-viewer:open", (event, rawUrl, title, contextId) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  return openDesktopViewer(owner, rawUrl, title, contextId);
}));

// URL validation, sandboxing, session isolation and the one-interactive-pane rule stay here, not in the renderer.
ipcMain.handle("desktop-workspace:open", localOnly("desktop-workspace:open", (event, input) =>
  desktopWorkspaceForEvent(event, true).open(input),
));
ipcMain.handle("desktop-workspace:layout", localOnly("desktop-workspace:layout", (event, items) => {
  const manager = desktopWorkspaceForEvent(event);
  if (!manager) return false;
  return manager.layout(items);
}));
ipcMain.handle("desktop-workspace:set-interactive", localOnly("desktop-workspace:set-interactive", (event, contextId) => {
  const manager = desktopWorkspaceForEvent(event);
  if (!manager) return contextId == null;
  return manager.setInteractive(contextId);
}));
ipcMain.handle("desktop-workspace:close", localOnly("desktop-workspace:close", (event, contextId) => {
  const manager = desktopWorkspaceForEvent(event);
  if (!manager) return true;
  return manager.close(contextId);
}));

// Only the owner of the current viewer may close it.
ipcMain.handle("desktop-viewer:close", localOnly("desktop-viewer:close", (_event, contextId) => {
  const scoped = Object.prototype.toString.call(contextId) === "[object String]" ? contextId : null;
  if (scoped !== desktopViewerContextId) return false;
  if (desktopViewerWindow && !desktopViewerWindow.isDestroyed()) desktopViewerWindow.close();
  return true;
}));

ipcMain.handle("desktop-viewer:state-now", localOnly("desktop-viewer:state-now", () => ({
  open: Boolean(desktopViewerWindow && !desktopViewerWindow.isDestroyed()),
  contextId: desktopViewerContextId,
})));

// No Screen Recording request path: on macOS 15+ preflight caches per process, a helper is TCC-attributed
// to itself on macOS 26, and Sequoia re-prompts anyway. The first real in-process capture prompts correctly.
let appPermissions = null;
ipcMain.handle("perm:status", (event) => ({
  mic:
    nativeActions.appleMediaPermissions
      ? systemPreferences.getMediaAccessStatus?.("microphone") ?? "unknown"
      : "unsupported",
  pageMic: appPermissions?.pageMicrophone(event) ?? "refused",
}));
ipcMain.handle("perm:request-mic", localOnly("perm:request-mic", () => askForMicrophone({ available: nativeActions.appleMediaPermissions, systemPreferences })));
const privacySettings = pane => openPrivacySettings(pane, { available: nativeActions.applePrivacySettings, openExternal: url => shell.openExternal(url) });
ipcMain.handle("perm:open-settings", localOnly("perm:open-settings", (_event, pane) => privacySettings(pane)));

ipcMain.handle("desktop:relaunch", localOnly("desktop:relaunch", (event) => {
  requireMainWindowSender(event);
  relaunchApp();
  return true;
}));

const talk = installTalk({ ipcMain, localOnly, BrowserWindow, appleSpeech: nativeActions.appleSpeech,
  speech: { start: startSpeech, stop: stopSpeech, finish: finishSpeech, busy: speechBusy }, packaged: app.isPackaged, devUrl: DEV_URL, nativeImage, iconPath: APP_ICON, openLink: queueChatLink, reveal: revealForLink, log: slog });

ipcMain.handle("companion:state", localOnly("companion:state", () => desktopCompanionState()));
ipcMain.handle("companion:start", localOnly("companion:start", () => startDesktopCompanion()));
ipcMain.handle("companion:stop", localOnly("companion:stop", () => stopDesktopCompanion()));
ipcMain.handle("companion:keep-awake", localOnly("companion:keep-awake", async (_event, enabled) => {
  rememberCompanionKeepAwake(Boolean(enabled));
  return desktopCompanionState();
}));
ipcMain.handle("routines:wake-state", localOnly("routines:wake-state", () => routineWake.poll()));
ipcMain.handle("routines:keep-awake", localOnly("routines:keep-awake", async (_event, enabled) => {
  rememberRoutineWake(app.getPath("userData"), Boolean(enabled));
  return routineWake.poll();
}));
ipcMain.handle("companion:refresh-tailscale", localOnly("companion:refresh-tailscale", () => refreshDesktopCompanionTailscale()));
ipcMain.handle("companion:pairing", localOnly("companion:pairing", (_event, open, expectedToken) =>
  companionPairing(Boolean(open), expectedToken).then(decorateDesktopCompanionState),
));
ipcMain.handle("companion:cloud-desktop", localOnly("companion:cloud-desktop", (_event, deviceId, allowed) =>
  companionCloudDesktopAccess(deviceId, Boolean(allowed)).then(() => desktopCompanionState()),
));
ipcMain.handle("companion:browser-control", localOnly("companion:browser-control", (_event, deviceId, allowed) =>
  companionBrowserControlAccess(deviceId, Boolean(allowed)).then(() => desktopCompanionState()),
));
ipcMain.handle("companion:revoke", localOnly("companion:revoke", (_event, deviceId) =>
  companionRevoke(deviceId).then(() => desktopCompanionState()),
));

function requireMainWindowSender(event) {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!sender || sender !== mainWindow || sender.isDestroyed() ||
      !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("The Openpals window is unavailable");
  }
}

function relaunchApp() {
  if (desktopShutdownStarted) return;
  desktopShutdownStarted = true;
  const timer = setTimeout(() => {
    // Electron's default relaunch reuses the native argv, which still holds the consumed one-shot action.
    app.relaunch({ args: process.argv.slice(1) });
    app.quit();
  }, 250);
  timer.unref?.();
}

const workspaceOnly = (handler) => (event, ...args) => {
  if (!workspaceSenderAllowed(event, mainWindow?.webContents, placeState, rendererOrigin())) throw new Error("These controls are only available in the main desktop window");
  return handler(event, ...args);
};
const localWorkspaceOnly = (channel, handler) => localOnly(channel, workspaceOnly(handler));
const localServerRequest = (route, init = {}) => (serverProc && serverReady ? fetch(`http://127.0.0.1:${SERVER_PORT}${route}`, { ...init, redirect: "error", credentials: "omit", headers: { ...init.headers, [DESKTOP_MUTATION_HEADER]: desktopMutationToken } }) : Promise.reject(new Error("not running")));
/** Every path that shows the window: the one there is, or a new one. */
function showHome() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
}

// window.confirm() has no parent window, so (tiling) window managers cannot center it over the app.
ipcMain.handle("dialog:confirm", localWorkspaceOnly("dialog:confirm", async (_event, message) => {
  if (typeof message !== "string" || !message.trim() || message.length > 4096 || !mainWindow || mainWindow.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    message,
    buttons: ["OK", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
}));

// The one place the window shows: read on any page of it, changed only from the person's click (preload) on that page.
ipcMain.handle("place:current", workspaceOnly(() => placeView(placeState)));
ipcMain.handle("place:connect", workspaceOnly((_event, link) => connectServer(link)));
ipcMain.handle("place:disconnect", workspaceOnly(() => disconnectServer()));

const INSTALLER_FILE = app.isPackaged ? path.join(process.resourcesPath, "install-server.sh") : path.join(__dirname, "..", "scripts", "install-server.sh");
let serverSetupRun = null;
let serverSetupProgress = null;

function reportServerSetup(progress) {
  serverSetupProgress = progress;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("server-setup:progress", progress);
}

/** Sets up an always-on server (on Boat, or the person's own over SSH) and switches this app to it. */
async function setUpServer(request) {
  const setup = request?.kind === "ssh"
    ? await setupOverSsh({ address: request.address, script: await fs.promises.readFile(INSTALLER_FILE, "utf8"), onProgress: reportServerSetup })
    : await setupOnBoat({ key: request?.key, onProgress: reportServerSetup });
  if (!setup.ok) {
    slog(`server setup: ${request?.kind} stopped (${setup.error.code})`);
    return setup;
  }
  reportServerSetup({ step: "connecting" });
  const link = parseHostedWorkspaceLink(setup.link);
  const opened = link ? await openServer(link) : { ok: false, error: "unreachable" };
  if (opened.ok) return opened;
  return { ok: false, error: opened.error === "unreachable" ? { code: "unreachable" } : { code: "install-failed", output: opened.error } };
}

// One setup at a time: a page that asks again (a reopened window) follows the one already running.
ipcMain.handle("server-setup:start", localWorkspaceOnly("server-setup:start", (_event, request) => {
  if (serverSetupRun) {
    if (serverSetupProgress) reportServerSetup(serverSetupProgress);
    return serverSetupRun;
  }
  serverSetupRun = setUpServer(request).finally(() => { serverSetupRun = null; serverSetupProgress = null; });
  return serverSetupRun;
}));

ipcMain.handle("desktop:capabilities", async (event) =>
  desktopCapabilities({
    remote: !senderIsLocal(event),
    platform: process.platform,
    env: process.env,
    packaged: app.isPackaged,
    localConnection: await cuaReady, frame: windowFrameNow(),
  }),
);

async function saveWorkspaceCredential(name, value) {
  const patchFor = CREDENTIAL_PATCH[name];
  if (!patchFor || typeof value !== "string") {
    throw new Error("Unsupported credential");
  }
  if (app.isPackaged && !(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("The operating-system credential store is unavailable");
  }
  const secret = value.trim();
  const applyToHarness = async () => {
    if (app.isPackaged && !serverReady) throw new Error("The embedded bot server is unavailable");
    const secretStorage = app.isPackaged ? "?secretStorage=external" : "";
    const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/config${secretStorage}`, {
      method: "PUT",
      headers: desktopServerHeaders(
        { "content-type": "application/json" },
        { packaged: app.isPackaged, token: desktopMutationToken },
      ),
      body: JSON.stringify(patchFor(secret)),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw credentialSaveError(response.status, body);
    return body;
  };
  if (!app.isPackaged) return applyToHarness();

  // Commit the encrypted value before the server makes it live; a failed reload rolls credentials.bin back.
  return updateSecureCredentialDocument(
    (credentials) => {
      if (secret) credentials[name] = secret;
      else delete credentials[name];
      return credentials;
    },
    applyToHarness,
  );
}

// The desktop's own dialog words for "Reset saved keys" (main has no catalog; {app} is filled in).
const RESET_SAVED_KEYS_WORDS = {
  "native.dialog.resetSavedKeys.title": "Reset saved keys?",
  "native.dialog.resetSavedKeys.detail": "{app} can't read its saved keys here, so it can't use them or save new ones. Resetting puts the unreadable file aside and restarts {app}. Then enter your keys again and reconnect your apps.",
  "native.dialog.resetSavedKeys.button": "Reset and restart",
  "native.dialog.resetSavedKeys.failed": "Couldn't reset saved keys",
  "native.common.cancel": "Cancel",
};
const resetSavedKeysT = (key, values = {}) => (RESET_SAVED_KEYS_WORDS[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
installCredentialStoreIpc({
  ipcMain, localOnly, dialog, windowFor: (sender) => BrowserWindow.fromWebContents(sender), t: resetSavedKeysT, appName: () => app.name,
  unreadable: () => credentialStoreUnavailable, quitting: () => desktopShutdownStarted,
  moveAside: () => fs.renameSync(CREDENTIALS_FILE, `${CREDENTIALS_FILE}.unreadable-${Date.now()}`), log: slog, relaunch: relaunchApp,
});
ipcMain.handle("credential:set", localOnly("credential:set", (_event, name, value) =>
  saveWorkspaceCredential(name, value),
));

ipcMain.handle("approvals:set-trusted-mode", localOnly("approvals:set-trusted-mode", (_event, botId, mode, options) => {
  // A separately launched dev server is outside this trust path: never degrade this grant to loopback HTTP.
  if (!app.isPackaged || !serverProc) {
    throw new Error("Full and Custom approval modes require the embedded desktop server");
  }
  return trustedApprovalMode.request(serverProc, botId, mode, options);
}));

// Electron fixes a Windows window's title bar when the window is made; on macOS the choice applies at once.
const windowFrameNow = () => (process.platform === "win32" ? windowFrameMade : null) ?? desktopPrefs?.windowFrame() !== false;
async function broadcastDesktopCapabilities() {
  const localConnection = await cuaReady;
  const build = (remote) =>
    desktopCapabilities({ remote, platform: process.platform, env: process.env, packaged: app.isPackaged, localConnection, frame: windowFrameNow() });
  const local = build(false);
  let redacted = null;
  for (const window of appWindows()) {
    if (window.isDestroyed()) continue;
    let isLocal = false;
    try {
      isLocal = new URL(window.webContents.getURL()).origin === rendererOrigin();
    } catch {}
    if (!isLocal) redacted ??= build(true);
    window.webContents.send("desktop:capabilities-changed", isLocal ? local : redacted);
  }
}

setCuaStateListener((connection) => {
  cuaReady = Promise.resolve(connection);
  void broadcastDesktopCapabilities().catch((error) => {
    console.error("[desktop] capability broadcast failed:", error);
  });
});

app.whenReady().then(async () => {
  await evictStartupCacheOnce({
    userData: app.getPath("userData"),
    currentVersion: app.getVersion(),
    clearCache: () => session.defaultSession.clearCache(),
    log: slog,
  });
  if (process.platform === "win32") {
    try {
      desktopTray = createSystemTray({
        Tray, Menu, nativeImage, iconPath: APP_ICON,
        getWindow: () => startupScreen?.window ?? mainWindow ?? (openWindowForLink?.(), mainWindow),
        onQuit: () => app.quit(),
      });
    } catch (error) {
      slog(`system tray unavailable: ${error?.message ?? error}`);
    }
  }
  startupScreen = createStartupScreen({
    BrowserWindow, iconPath: APP_ICON, isQuitting: () => desktopShutdownStarted,
    onQuit: () => app.quit(),
    onHide: desktopTray ? (win) => desktopTray.hide(win) : undefined,
    isHidden: () => desktopTray?.isHidden() ?? false,
    onShow: (win) => desktopTray?.windowShown(win),
    onFinished: () => { startupScreen = null; },
  });
  await startupScreen?.ready;
  if (desktopShutdownStarted) return;
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSavePath(collisionFreeDownloadPath(app.getPath("downloads"), item.getFilename()));
    revealDownloadWhenDone(item, (filePath) => shell.showItemInFolder(filePath));
  });
  placeState = placeFile.read();
  if (app.isPackaged) {
    try {
      // Acquire before either plaintext credential migration touches config.json.
      desktopDataDirLease = acquireDataDirLease(desktopDataDir(), {
        legacyDataDir: path.join(app.getPath("home"), ".opengrokbot"),
      });
    } catch (error) {
      dialog.showErrorBox(
        "Openpals could not start safely",
        error?.message ?? "Another process is using this Openpals data folder.",
      );
      app.quit();
      return;
    }
  }
  installServerSessions({ app, defaultSession: session.defaultSession, serverPort: () => SERVER_PORT,
    ownerToken: () => (app.isPackaged && serverReady ? desktopMutationToken : null) });
  if (app.isPackaged) app.setAsDefaultProtocolClient("openmausbot");
  if (process.platform === "darwin") app.dock.setIcon(APP_ICON);
  secureCredentials = await loadSecureCredentials();
  // An orphaned third-party key with no clear handler left: drop it rather than keep it at rest.
  if (secureCredentials && Object.hasOwn(secureCredentials, "assemblyAiApiKey") && !credentialStoreUnavailable) {
    try {
      const { assemblyAiApiKey: _removed, ...rest } = secureCredentials;
      await saveSecureCredentials(rest);
      secureCredentials = rest;
    } catch (error) {
      slog(`orphaned AssemblyAI key not removed: ${error?.message ?? error}`);
    }
  }
  if (app.isPackaged) {
    await secureComposioConfig();
    await secureWorkspaceConfig();
  }
  // From here on every credential writer must go through this serialized state.
  secureCredentialState = createSecureCredentialState(secureCredentials, saveSecureCredentials, {
    writable: !credentialStoreUnavailable,
  });
  secureCredentials = secureCredentialState.read();
  if (app.isPackaged) await ensurePhoneSecretIdentity();
  // Display capture needs a one-shot renderer intent from the same frame/origin, no audio, and a user gesture.
  if (process.platform === "darwin" || process.platform === "linux") {
    session.defaultSession.setDisplayMediaRequestHandler(
      (request, callback) => {
        displayMediaRequestCount += 1;
        if (!displayMediaGuard.consume(request, rendererOrigin())) {
          respondToDisplayMediaRequest(callback, {});
          return;
        }

        const capabilities = desktopCapabilities({
          platform: process.platform,
          env: process.env,
          packaged: app.isPackaged,
        });
        const captureHost =
          process.platform === "darwin" ? "darwin" : capabilities.host.session;
        if (!capabilities.screenPreview.available) {
          respondToDisplayMediaRequest(callback, {});
          return;
        }

        desktopCapturer
          .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
          .then((sources) => {
            const source = selectCaptureSource({
              sources,
              host: captureHost,
              primaryDisplayId:
                process.platform === "linux" && captureHost === "x11"
                  ? screen.getPrimaryDisplay().id
                  : null,
            });
            if (!source) {
              console.warn(
                `[screen-preview] rejected ${captureHost} source set (${sources.length} candidates)`,
              );
            }
            respondToDisplayMediaRequest(callback, source ? { video: source } : {});
          })
          .catch((error) => {
            console.warn("[screen-preview] source discovery failed:", error);
            respondToDisplayMediaRequest(callback, {});
          });
      },
      { useSystemPicker: false },
    );
  }
  registerCuaIpc();
  androidDevice.registerIpc(ipcMain);
  desktopPrefs = createDesktopPrefs(jsonFile(path.join(app.getPath("userData"), "desktop-prefs.json")));
  registerDesktopPrefs({ ipcMain, prefs: desktopPrefs,
    frame: { made: () => windowFrameMade, restarts: process.platform === "win32", changed: () => void broadcastDesktopCapabilities() },
    languageChanged: (language, sender) => {
      for (const win of appWindows()) if (!win.isDestroyed() && win.webContents !== sender) win.webContents.send("desktop-language:changed", language);
    },
    page: event => senderIsLocal(event) ? "local" : workspaceSenderAllowed(event, mainWindow?.webContents, placeState, rendererOrigin()) ? "server" : null });
  talk.start({ globalShortcut, screen, prefs: desktopPrefs, starting: () => !serverReady, localRequest: localServerRequest, dataDir: desktopDataDir });
  // Before the window, so the harness has the CUA descriptor on first render.
  cuaReady =
    process.platform === "darwin" || process.platform === "linux" || process.platform === "win32"
      ? startCua().catch((e) => {
          console.error("[cua] start failed:", e);
          return { mode: "unavailable", reason: String(e) };
        })
      : Promise.resolve({ mode: "unavailable", reason: "unsupported-platform" });
  if (app.isPackaged) await startServerPackaged();
  if (desktopShutdownStarted) return;
  if (serverReady && companionEnabledAtRest()) {
    // Retries stop once the person turns the phone off, starts it by hand or quits.
    const wanted = () => !desktopShutdownStarted && companionEnabledAtRest() && !companionRunning();
    void autoStartCompanion({ start: () => startDesktopCompanion({ remember: false }), wanted, log: slog });
  }
  setLocalOrigin(rendererOrigin());
  appPermissions = appPermissionHandlers({
    rendererOrigin,
    mainContents: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null),
    activeRemoteOrigin: () => activeServer(placeState)?.origin ?? null,
    activeRemoteMicrophone: () => activeServer(placeState)?.microphone === true,
    askRemoteMicrophone,
  });
  session.defaultSession.setPermissionRequestHandler(appPermissions.request);
  session.defaultSession.setPermissionCheckHandler(appPermissions.check);
  showHome();
  refreshApplicationMenu();
  openWindowForLink = showHome;
  app.on("activate", () => {
    if (desktopTray?.show()) return;
    if (appWindows().length === 0) openWindowForLink();
  });
}).finally(() => allWindowsClosedQuit.settleStartup());

const allWindowsClosedQuit = createAllWindowsClosedQuit({
  app,
  allWindows: () => appWindows(),
});

// The embedded CUA daemon's async cleanup cannot run after the host exits, so the first quit waits for it (capped).
const CUA_STOP_TIMEOUT_MS = 2500;
let cuaCleanedUp = false;
let signalQuitRequested = false;

// Linux package managers and watchdogs stop apps with SIGTERM/SIGINT: the first becomes a normal quit,
// a second keeps Node's default force-quit (`once` listeners).
const requestSignalQuit = () => {
  if (signalQuitRequested) return;
  signalQuitRequested = true;
  app.quit();
};
process.once("SIGINT", requestSignalQuit);
process.once("SIGTERM", requestSignalQuit);

app.on("before-quit", (e) => {
  talk.close();
  desktopShutdownStarted = true;
  startupScreen?.dispose();
  if (cuaCleanedUp) return;
  e.preventDefault();
  // Cancel a scheduled recovery before yielding.
  const stoppingServer = serverSupervisor.shutdown();
  syncCompanionKeepAwake(false, false);
  routineWake.stop();
  if (nativeActions.appleSpeech) stopSpeech();
  const ownedHelperCleanup = Promise.race([
    Promise.all([
      stopCua().catch(() => {}),
      stopDesktopCompanion({ remember: false }).catch(() => {}),
    ]),
    new Promise((resolve) => setTimeout(resolve, CUA_STOP_TIMEOUT_MS).unref()),
  ]);
  const cleanup = Promise.all([
    ownedHelperCleanup,
    stoppingServer.then((stopped) => {
      if (!stopped) slog("server child did not stop before desktop exit; retaining the data-directory lease");
    }),
  ]);
  cleanup.then(() => {
    cuaCleanedUp = true;
    app.quit();
  });
});

function releaseDesktopDataDirLease() {
  if (!desktopDataDirLease) return;
  try {
    desktopDataDirLease.release();
    desktopDataDirLease = null;
  } catch (error) {
    // Never print the private child capability.
    slog(`data-directory lease release failed: ${error?.message ?? error}`);
  }
}

// before-quit is too early (this app defers it); will-quit is Electron's last boundary, and the process hook covers app.exit().
app.on("will-quit", releaseDesktopDataDirLease);
app.on("will-quit", () => desktopTray?.destroy());
process.once("exit", releaseDesktopDataDirLease);
