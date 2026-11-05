// One person's connected apps on this computer and on a server of their own: the server saves the same Composio key and
// user. A server whose own apps are already connected keeps them: each app connected here is then connected there once.
import { createHash } from "node:crypto";

import * as composio from "./composio.ts";
import { saveConfig, syncCredentialEnv, type AppConfig } from "./config.ts";

/** This server's connected-apps account, in digests: two servers reach the same apps exactly when `account` is equal. */
export interface ComposioIdentity {
  account: string;
  /** The apps connected now, as last read; absent until the first read. */
  apps?: string[];
}

const APPS_TTL_MS = 10 * 60_000;
const ownDigest = (userId: string) => createHash("sha256").update(`omb-composio-own:${userId}`).digest("hex").slice(0, 24);

let apps: { key: string; at: number; slugs: string[] } | null = null;
let appsReading: Promise<void> | null = null;

/** The apps connected now, read at most every ten minutes and never waited for: the first call starts the read. */
function connectedApps(cfg: AppConfig, key: string): string[] | undefined {
  const fresh = apps && apps.key === key && Date.now() - apps.at < APPS_TTL_MS;
  if (!fresh && !appsReading) {
    appsReading = composio.connectedServices(cfg)
      .then((services) => { apps = { key, at: Date.now(), slugs: Object.entries(services).filter(([, state]) => state.connected).map(([slug]) => slug).sort() }; })
      .catch(() => {})
      .finally(() => { appsReading = null; });
  }
  return apps?.key === key ? apps.slugs : undefined;
}

/** Null when this server has no connected-apps account. */
export function composioIdentity(cfg: AppConfig): ComposioIdentity | null {
  const userId = cfg.composio?.userId;
  if (!composio.configured(cfg) || !userId) return null;
  return { account: `own:${ownDigest(userId)}`, apps: connectedApps(cfg, `own:${userId}`) };
}

export type ShareOutcome = { shared: true } | { kept: true };

/** Saves this computer's own Composio project here, for the same user, unless this server already has its own. */
export async function adoptOwnComposio(cfg: AppConfig, apiKey: string, userId: string): Promise<ShareOutcome> {
  const current = cfg.composio;
  if (current?.apiKey?.trim()) return current.apiKey.trim() === apiKey.trim() && current.userId === userId ? { shared: true } : { kept: true };
  const prepared = await composio.prepareProjectSession(apiKey, { userId });
  saveConfig({ composio: prepared });
  syncCredentialEnv({ composio: prepared });
  cfg.composio = prepared;
  apps = null;
  return { shared: true };
}
