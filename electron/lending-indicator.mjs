// The menu-bar (macOS) or notification-area (Windows) item shown while this computer is lent to the person's server:
// always visible while bots there can use it, with Pause, Resume and Stop one click away.
import { screenFixLabel, screenLine } from "./screen-words.mjs";

/** The device word the person knows this computer by. */
export const deviceWord = (platform = process.platform) => platform === "darwin" ? "Mac" : platform === "win32" ? "PC" : "computer";

/** What the item says: `line` is the menu's first line, `title` the word beside the icon (macOS), `screen` why apps and
 * screen can't be used now. */
export function indicatorText({ server, paused, state, busy, screen = null }, device) {
  const it = `this ${device}`;
  const name = server ?? "your server";
  if (paused) return { line: `Paused: bots on ${name} can't use ${it}`, title: "Paused", screen: null };
  if (state === "connecting") return { line: `Connecting ${it} to ${name}…`, title: "", screen: null };
  if (state !== "online") return { line: `Can't reach ${name} now; ${it} keeps trying`, title: "", screen: null };
  const why = screenLine(screen, device);
  if (busy) return { line: `A bot on ${name} is using ${it}`, title: "In use", screen: why };
  return { line: why ? `Bots on ${name} can use ${it}, but not its apps and screen` : `Bots on ${name} can use ${it}`, title: "", screen: why };
}

export function createLendingIndicator({ Tray, Menu, nativeImage, iconPath, onPause, onResume, onStop, onActivity, onTerminal, onOpenSettings = () => {}, onStartScreen = () => {}, device = deviceWord() }) {
  let tray = null;
  let shown = null;
  const draw = view => {
    if (!tray || tray.isDestroyed()) return;
    const { line, title, screen } = indicatorText(view, device);
    const fix = screen ? screenFixLabel(view.screen) : null;
    tray.setToolTip(`Openpals: ${line}${screen ? `. ${screen}` : ""}`);
    // Electron shows a tray title beside the icon on macOS only.
    tray.setTitle?.(title);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: line, enabled: false },
      ...screen ? [{ label: screen, enabled: false }] : [],
      ...fix ? [{ label: fix, click: () => onStartScreen() }] : [],
      { type: "separator" },
      view.paused ? { label: "Resume", click: () => onResume() } : { label: "Pause", click: () => onPause() },
      ...view.paused ? [] : [{ label: `Let bots run commands on this ${device}`, type: "checkbox", checked: view.terminal,
        // Electron ticks a checkbox on click by itself: the menu keeps the saved choice until the person confirms one.
        click: () => { draw(view); onTerminal(!view.terminal); } }],
      { label: "See activity", click: () => onActivity() },
      { label: "Settings…", click: () => onOpenSettings() },
      { type: "separator" },
      { label: `Stop lending this ${device}`, click: () => onStop() },
    ]));
  };
  return {
    update({ on = false, server = null, paused = false, state = "off", busy = null, terminal = false, screen = null }) {
      const next = { on: on === true, server, paused: paused === true, state, busy: paused ? null : busy, terminal: terminal === true,
        screen: screen ? { ready: screen.ready === true, reason: screen.reason ?? null, fix: screen.fix ?? null, ...(screen.message ? { message: screen.message } : {}) } : null };
      if (shown && JSON.stringify(next) === JSON.stringify(shown)) return;
      shown = next;
      if (!next.on) { if (tray && !tray.isDestroyed()) tray.destroy(); tray = null; return; }
      if (!tray || tray.isDestroyed()) {
        tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 }));
        tray.on("click", () => tray?.popUpContextMenu?.());
      }
      draw(next);
    },
    destroy() { if (tray && !tray.isDestroyed()) tray.destroy(); tray = null; shown = null; },
  };
}
