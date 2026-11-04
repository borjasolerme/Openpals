// A turn's connected apps (Composio) and MCP servers. A turn never waits on a refresh of the connected apps: what is known
// is used at once, and read again in the background once it is a minute old. Only the first answer is waited for, at most
// a few seconds, and a failed first read is tried again soon; `primeApps` reads them at start.
import type * as Composio from "../composio.ts";
import type { AppConfig } from "../config.ts";
import type { McpServerSpec } from "../contracts.ts";
import { type McpOAuthManager, withMcpSignIn, withoutPendingSignIn } from "../mcp-oauth.ts";
import { APP_TOOL_NAMES_ENV, APP_TOOLS_ENV, appToolsFor } from "../connector-app-tools.ts";
import type { ConnectorScopes } from "../../shared/connector-scopes.ts";

type Bot = { id: string; name: string; connectorTools?: Parameters<typeof Composio.mcpIntegration>[1]["connectorTools"]; connectorScopes?: ConnectorScopes };
type Integration = { command: string; args: string[]; env: Record<string, string> };
type McpBot = { id: string; name: string; mcpServers?: string[] };

export interface ConnectedAppsHostDeps {
  cfg: () => AppConfig;
  harnessUrl: string;
  /** A `connectors` capability for this turn. */
  mint(capability: { botId: string; threadId: string; generation: string }): string;
  mcpOAuth: McpOAuthManager;
  /** The bot's enabled MCP servers, as policy allows them, before any sign-in is attached. */
  botMcp(bot: McpBot): Record<string, McpServerSpec>;
  composio: Pick<typeof Composio, "configured" | "mcpIntegration" | "connectedServices">;
}

const APPS_FRESH_MS = 60_000, APPS_RETRY_MS = 10_000, FIRST_APPS_WAIT_MS = 3_000;

export function createConnectedAppsHost(deps: ConnectedAppsHostDeps) {
  const connected: { at: number; apps: string[] | null; reading: Promise<void> | null } = { at: -Infinity, apps: null, reading: null };
  const appsConnected = async (): Promise<string[]> => {
    const entry = connected;
    if (!entry.reading && Date.now() - entry.at >= (entry.apps ? APPS_FRESH_MS : APPS_RETRY_MS)) {
      entry.reading = deps.composio.connectedServices(deps.cfg()).then((services) => {
        entry.apps = Object.entries(services).filter(([, state]) => state.connected).map(([slug]) => slug);
      }, () => {}).finally(() => { entry.at = Date.now(); entry.reading = null; });
    }
    if (!entry.apps && entry.reading) {
      await Promise.race([entry.reading, new Promise<void>((resolve) => { setTimeout(resolve, FIRST_APPS_WAIT_MS).unref?.(); })]);
    }
    return entry.apps ?? [];
  };

  return {
    /** At start: the connected apps are read now, so the first turn need not wait for them. */
    primeApps(): void {
      if (deps.composio.configured(deps.cfg())) void appsConnected();
    },

    /** The connected-apps bridge of a turn. `names`: how the engine spells the app tools' names. */
    async appsIntegrations(bot: Bot, threadId: string, generation: string, names: "dotted" | "plain" = "plain"): Promise<{ composio?: Integration }> {
      const bridge = await deps.composio.mcpIntegration(deps.cfg(), { harnessUrl: deps.harnessUrl, botId: bot.id, threadId, connectorTools: bot.connectorTools,
        commsToken: deps.mint({ botId: bot.id, threadId, generation }) });
      if (!bridge) return {};
      const tools = appToolsFor(bot, await appsConnected());
      return { composio: tools.length ? { ...bridge, env: { ...bridge.env, [APP_TOOLS_ENV]: JSON.stringify(tools), [APP_TOOL_NAMES_ENV]: names } } : bridge };
    },

    /** A turn's MCP servers, with their sign-ins attached. */
    turnMcp(bot: McpBot): Promise<Record<string, McpServerSpec>> {
      return withMcpSignIn(deps.botMcp(bot), deps.mcpOAuth);
    },

    /** The bot's servers with no conversation in view (the setup preview, approval keys, chat apps). */
    engineMcp(bot: McpBot): Record<string, McpServerSpec> {
      return withoutPendingSignIn(deps.botMcp(bot), deps.mcpOAuth);
    },
  };
}
