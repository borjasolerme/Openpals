/** Whether this app's desktop shell could not read its saved keys this launch. False on a page without that shell, or
 * on any error. */
export async function savedKeysUnreadable(bridge: Window["ogb"] = window.ogb): Promise<boolean> {
  if (!bridge?.credentialStore) return false;
  try {
    return (await bridge.credentialStore.unreadable()) === true;
  } catch {
    return false;
  }
}
