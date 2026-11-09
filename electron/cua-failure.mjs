/** @trycua/cua-driver 0.28.2's errors carry only their kind as a message ("EmbeddedDriverError.Spawn"); the reason the
 * system gave, the exit code or the timeout is in `inner`. */
export function driverFailure(error) {
  const kind = typeof error?.tag === "string" ? error.tag : null;
  const inner = error?.inner && typeof error.inner === "object" ? error.inner : null;
  if (!kind || !inner) return String(error?.message ?? error);
  const said = Object.entries(inner).filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key} ${String(value)}`);
  return said.length ? `${kind}: ${said.join("; ")}` : kind;
}

const PANES = Object.freeze(["accessibility", "screen"]);
/** The macOS permissions computer control lacks, in the order macOS asks for them, from its own start-up failure
 * ("Accessibility and Screen Recording required"): reading it never asks macOS anything. */
export function missingPermissions(reason) {
  const list = typeof reason === "string" ? /((?:Accessibility|Screen Recording)(?: and (?:Accessibility|Screen Recording))?) required\b/iu.exec(reason)?.[1] ?? "" : "";
  return PANES.filter((pane) => (pane === "screen" ? /Screen Recording/iu : /Accessibility/iu).test(list));
}
