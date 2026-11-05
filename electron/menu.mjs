// Electron has no role for the macOS Preferences… item, so it is built explicitly.
import { Menu, app } from "electron";

/**
 * @param {object} input
 * @param {{ name: string, origin: string } | null} input.server  the server the window shows, or null for this computer
 * @param {() => void} input.onConnectFromClipboard
 * @param {() => void} input.onDisconnect
 * @param {() => void} input.onOpenSettings
 * @param {{ checked: boolean, onToggle: (on: boolean) => void } | null} [input.openAtLogin] Open at Login, in the app
 *   menu on macOS and the File menu elsewhere; absent when this build cannot add a login item.
 */
export function buildApplicationMenu({ server, onConnectFromClipboard, onDisconnect, onOpenSettings, openAtLogin = null }) {
  const isMac = process.platform === "darwin";
  const serverMenu = {
    label: "Server",
    submenu: server
      ? [{ id: "server-disconnect", label: `Disconnect from “${server.name}”…`, click: () => onDisconnect() }]
      : [{ id: "server-connect", label: "Connect to a Server from Copied Pairing Link…", click: () => onConnectFromClipboard() }],
  };
  const atLogin = openAtLogin ? [{ id: "open-at-login", label: "Open at Login", type: "checkbox", checked: openAtLogin.checked, click: () => openAtLogin.onToggle(!openAtLogin.checked) }] : [];
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: "about" }, { label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => onOpenSettings() }, ...atLogin, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }] : []),
    !isMac && openAtLogin ? { label: "File", submenu: [...atLogin, { type: "separator" }, { role: "quit" }] } : { role: "fileMenu" },
    { role: "editMenu" },
    serverMenu,
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}
