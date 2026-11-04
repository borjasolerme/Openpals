/** `GET /api/x/status`, the Apps page's X card. Never a key or a token. `ownKey`: the person's own treg key is saved, so
 * the X tools are shown to bots. */
export interface XConnectorStatus {
  ownKey: boolean;
}

export function isXConnectorStatus(value: unknown): value is XConnectorStatus {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).ownKey === "boolean";
}
