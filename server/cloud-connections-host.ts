// The one-time move of this computer's connections to a server of the person's own, in one object: its routes
// (routes/cloud-connections.ts) and the private port's answers to the desktop's main process (login-handoff.ts).
import { hostname } from "node:os";

import { answerConnection, connectionFingerprints, highlevelDigest, launchersOnPath, listConnections, releaseConnection, signInDigest } from "./cloud-connections.ts";
import * as composio from "./composio.ts";
import { adoptOwnComposio, composioIdentity } from "./composio-share.ts";
import type { AppConfig } from "./config.ts";
import type { HighLevelService } from "./highlevel/service.ts";
import type { ConnectionHandoffAnswer, ConnectionHandoffWhat } from "./login-handoff.ts";
import type { McpOAuthManager } from "./mcp-oauth.ts";
import type { RequestAuth } from "./request-auth.ts";
import { isRemoteMcpServer, parseStoredMcpServer, type McpRunsOn } from "./mcp-registry.ts";
import { createCloudConnectionRoutes } from "./routes/cloud-connections.ts";

export interface CloudConnectionsHostDeps {
  /** A server of one person's own takes that person's connections. */
  ownHome(auth: RequestAuth): boolean;
  config(): AppConfig;
  /** This server's own environment id: the computer a server that needs it is marked as running on. */
  environmentId: string;
  mcpOAuth: Pick<McpOAuthManager, "authState" | "signInRecord" | "adopt" | "forget">;
  highlevel: Pick<HighLevelService, "store" | "connected" | "adopt" | "disconnect">;
  /** The engines (instance ids) ready to run here now. */
  engines(): Promise<string[]>;
}

export function createCloudConnectionsHost(deps: CloudConnectionsHostDeps) {
  const label = (process.env.OMB_ENVIRONMENT_LABEL?.trim() || hostname()).slice(0, 120).trim() || "the person's computer";
  const computer: McpRunsOn = { environmentId: deps.environmentId, label };
  let commands: string[] | null = null;
  const mcpAuth = (name: string, url: string) => deps.mcpOAuth.authState(name, url);
  const sources = () => ({ config: deps.config(), mcpSignIn: (name: string, url: string) => deps.mcpOAuth.signInRecord(name, url), highlevel: () => deps.highlevel.store.get() });
  const composioConnected = async (slugs: string[]) =>
    Object.fromEntries(Object.entries(await composio.connectionStatus(deps.config(), slugs)).map(([slug, state]) => [slug, state.connected]));
  const connections = async () => {
    const cfg = deps.config();
    return listConnections({ config: cfg, mcpAuth, composio: composioIdentity(cfg), highlevel: () => deps.highlevel.store.get() });
  };

  return {
    connections,
    fingerprints: (nonce: string) => connectionFingerprints(nonce, sources()),
    routes: createCloudConnectionRoutes({
      ownHome: deps.ownHome,
      async list() {
        return { computer, connections: await connections(), engines: await deps.engines().catch((): string[] => []), commands: commands ??= launchersOnPath() };
      },
      adoptOwn: (apiKey, userId) => adoptOwnComposio(deps.config(), apiKey, userId),
      composioConnected,
      adoptSignIn(name, record, replaces) {
        const raw = deps.config().mcpServers?.[name];
        const parsed = raw === undefined ? null : parseStoredMcpServer(name, raw);
        if (!parsed?.ok || !isRemoteMcpServer(parsed.server)) return { ok: false, status: 404, error: "This MCP server is not here yet." };
        if (parsed.server.url !== record.url) return { ok: false, status: 409, error: "This MCP server has another address here." };
        return { ok: true, outcome: deps.mcpOAuth.adopt(name, parsed.server.url, record, replaces ? (current) => signInDigest(current.tokens) === replaces : undefined) };
      },
      adoptHighLevel: (connection, replaces) => ({ ok: true, outcome: deps.highlevel.adopt(connection, replaces ? (current) => highlevelDigest(current) === replaces : undefined) }),
    }),

    /** The private port's ask: one connection's secrets, or letting go of a sign-in that moved. */
    async handoff(what: ConnectionHandoffWhat): Promise<ConnectionHandoffAnswer> {
      if (what.kind === "connection-fingerprints") return { ok: true, secrets: connectionFingerprints(what.nonce, sources()) };
      if (what.kind === "connection-release") {
        return releaseConnection(what.id, what.digest, { ...sources(), forgetSignIn: (name) => deps.mcpOAuth.forget(name), forgetHighLevel: () => { deps.highlevel.disconnect(); } });
      }
      return answerConnection(what.id, sources());
    },
  };
}
