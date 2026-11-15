// What the menu-bar or taskbar icon and Settings say when this computer's apps and screen can't be lent to the person's
// server, from computer control's state.

/** Why apps and screen aren't available, as one plain sentence without a full stop; null when they are. */
export function screenLine(status, device) {
  if (!status || status.ready) return null;
  switch (status.reason) {
    case "starting": return `Screen control is starting on this ${device}`;
    case "permissions": return "macOS hasn't allowed screen control yet";
    case "blocked": return device === "PC"
      ? "Screen control is blocked: Windows Security may have stopped it"
      : `Screen control is blocked on this ${device}`;
    case "off": return `Screen control is off on this ${device}`;
    case "unsupported": return status.message ? status.message.replace(/\.$/, "") : `Screen control can't work on this ${device}`;
    default: return `Screen control isn't running on this ${device}`;
  }
}

/** The one action that fixes it, as a menu item or button; null when nothing here can. */
export function screenFixLabel(status) {
  if (!status || status.ready || !status.fix) return null;
  if (status.fix === "allow") return "Allow screen control…";
  return status.reason === "off" ? "Turn on screen control" : "Start screen control";
}
