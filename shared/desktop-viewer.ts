// The names the desktop proxy (`/api/desktop-viewer/<target>`) serves: one rule for the server and the renderer.

/** A bot's VPS desktop is `vps/<botId>`. */
export const DESKTOP_VIEWER_TARGET = /^vps\/[\w-]+$/;
