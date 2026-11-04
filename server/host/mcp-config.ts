import { withMcpSignIn, type McpOAuthManager } from "../mcp-oauth.ts";
import { brokeredServer, type BrokerPath } from "../bot-box/broker-probe.ts";
import { probeMcpServer, type McpProbeOptions, type McpProbeResult } from "../mcp-probe.ts";
import { MAX_MCP_SERVERS, isRemoteMcpServer, parseStoredMcpServer, type McpRunsOn, type StoredMcpServer, type StoredRemoteMcpServer } from "../mcp-registry.ts";
import { postizKeyHeaders } from "../postiz/connection.ts";
import type { AppConfig } from "../config.ts";
import type { ChatAppsMcp } from "../chat-apps-mcp.ts";
import type { BusyFlag } from "../routes/config.ts";
import type { SessionRegistry } from "../sessions.ts";

export interface McpConfigDeps {
  cfg: Pick<AppConfig, "mcpServers" | "postiz">;
  sessions: Pick<SessionRegistry, "isLive">;
  mcpOAuth: McpOAuthManager;
  fallbackPublicUrl: string | null;
  mcpConfigBusy: BusyFlag;
  /** Secrets as booleans, sign-in state attached. */
  mcpServerResponse(): Record<string, unknown>;
  persistMcpServers(next: Record<string, unknown>): void;
  savedCustomDomain(): string | null;
  appCatalog?: Pick<ChatAppsMcp, "probeOptions" | "serverChanged" | "forgetServer"> & Partial<Pick<ChatAppsMcp, "hasApps">>;
  /** Whether each command server starts for each bot: checked again when one is added, changed, turned on or restarted. */
  health?: { changed(name: string): void };
  /** How bots' turns reach a URL server here: through the broker where turns are boxed (null: directly). */
  botsPath?(): BrokerPath | null;
  /** How Test starts a command server when no bot asks: as the turns of its bot, or of any bot (server/mcp-probe.ts `asBot`). */
  probeAs?(server: { bot?: string }): NonNullable<McpProbeOptions["asBot"]>;
}

export type McpConfigRefusal = { status: number; error: string; code?: string };
export type McpConfigResult = { status: number; body: Record<string, unknown> } | McpConfigRefusal;

export interface McpConfig {
  add(name: string, server: StoredMcpServer): McpConfigResult;
  replace(name: string, server: StoredMcpServer): McpConfigResult;
  /** Several servers at once, all or none; they arrive disabled. `read` runs with the flag held, so another writer is
   * refused for the whole request, its body included. */
  addMany(read: () => Promise<{ servers: Record<string, StoredMcpServer> } | McpConfigRefusal>): Promise<McpConfigResult>;
  setEnabled(name: string, enabled: boolean): McpConfigResult;
  /** The next turn of every bot that uses it starts a new process, with what is saved today: keys, sign-in and all. */
  restart(name: string): McpConfigResult;
  setApps(name: string, apps: boolean): McpConfigResult;
  remove(name: string): McpConfigResult;
  /** A 200 carries the probe result as its body, failures included: only a refusal to probe is an error. */
  test(name: string, options: {
    asBot?: { id: string; cwd: string };
    signal: AbortSignal;
  }): Promise<McpConfigResult>;
  /** The one flag every writer of `cfg.mcpServers` takes: two writers must not interleave a read with a save. */
  busy: BusyFlag;
}

/** Where turns are boxed, a URL server is tested the way bots reach it: through the broker. If that fails but the server
 * answers directly, the fault is ours, never the person's settings, and the test says so instead of "Connected". */
async function probeAsBots(path: BrokerPath, name: string, target: StoredRemoteMcpServer, signal: AbortSignal, options: McpProbeOptions): Promise<McpProbeResult> {
  const brokered = brokeredServer(path, name, target);
  let result: McpProbeResult;
  try {
    result = await probeMcpServer(target, undefined, signal, { ...options, via: { url: brokered.url, fetch: brokered.fetch } });
  } finally {
    await brokered.done();
  }
  if (result.ok || result.auth === "required" || signal.aborted) return result;
  const direct = await probeMcpServer(target, undefined, signal);
  return direct.ok
    ? { ok: false, reason: "unreachable", error: `Your bots can't reach this server: ${result.error.replace(/ Check [^.]*\.$/, "")} It answers when tested directly, so the fault is on our side, not in your settings: tell us with @devs in any chat.` }
    : result;
}

/** A server of another computer's: its program, files or address are there, so it is never started or signed in to here. */
export const runsElsewhere = (runsOn: McpRunsOn) => `This server runs on ${runsOn.label}, so it isn't started here.`;

const MAX_CONCURRENT_MCP_PROBES = 2;
export const MCP_CONFIG_BUSY = "MCP servers are already being updated.";

export function createMcpConfig(deps: McpConfigDeps & { changed(): void }): McpConfig {
  const { cfg, mcpOAuth, mcpConfigBusy, mcpServerResponse, persistMcpServers, appCatalog, health } = deps;
  let mcpProbesInFlight = 0;

  const held = async <T,>(run: () => T | Promise<T>): Promise<T | McpConfigRefusal> => {
    if (mcpConfigBusy.get()) return { status: 409, error: MCP_CONFIG_BUSY };
    mcpConfigBusy.set(true);
    try {
      return await run();
    } finally {
      mcpConfigBusy.set(false);
    }
  };
  const announced = (result: McpConfigResult): McpConfigResult => {
    if ("body" in result) deps.changed();
    return result;
  };
  const write = (run: () => McpConfigResult): McpConfigResult => {
    if (mcpConfigBusy.get()) return { status: 409, error: MCP_CONFIG_BUSY };
    mcpConfigBusy.set(true);
    try {
      return announced(run());
    } finally {
      mcpConfigBusy.set(false);
    }
  };
  const saved = (status: number): McpConfigResult => ({ status, body: mcpServerResponse() });
  const stored = (name: string) => {
    const current = cfg.mcpServers ?? {};
    if (!Object.hasOwn(current, name)) return { result: { status: 404, error: "MCP server not found." } as McpConfigResult };
    const existing = parseStoredMcpServer(name, current[name]);
    return existing.ok ? { current, existing: existing.server } : { result: { status: 400, error: existing.error } as McpConfigResult };
  };
  const refused = (_name: string, _server: StoredMcpServer): McpConfigResult | null => null;

  return {
    busy: mcpConfigBusy,
    add: (name, server) => write(() => {
      const current = cfg.mcpServers ?? {};
      if (Object.hasOwn(current, name)) return { status: 409, error: "An MCP server with that name already exists." };
      if (Object.keys(current).length >= MAX_MCP_SERVERS) {
        return { status: 400, error: `You can add at most ${MAX_MCP_SERVERS} MCP servers.` };
      }
      const refusal = refused(name, server);
      if (refusal) return refusal;
      persistMcpServers({ ...current, [name]: server });
      appCatalog?.serverChanged(name);
      health?.changed(name);
      return saved(201);
    }),
    addMany: (read) => held(async () => {
      const request = await read();
      if ("error" in request) return request;
      const { servers } = request;
      const current = cfg.mcpServers ?? {};
      const names = Object.keys(servers);
      const taken = names.filter((name) => Object.hasOwn(current, name));
      if (taken.length) {
        return { status: 409, error: `Already added: ${taken.join(", ")}. Remove or rename ${taken.length === 1 ? "it" : "them"} first.` };
      }
      if (Object.keys(current).length + names.length > MAX_MCP_SERVERS) {
        return { status: 400, error: `You can add at most ${MAX_MCP_SERVERS} MCP servers.` };
      }
      persistMcpServers({ ...current, ...servers });
      return announced({ status: 201, body: { ...mcpServerResponse(), added: names } });
    }),
    replace: (name, server) => write(() => {
      const found = stored(name);
      if (!found.existing) return found.result!;
      const refusal = refused(name, server);
      if (refusal) return refusal;
      persistMcpServers({ ...found.current, [name]: server });
      appCatalog?.forgetServer(name);
      appCatalog?.serverChanged(name);
      health?.changed(name);
      // A sign-in belongs to one address: a token never follows the entry elsewhere.
      const before = isRemoteMcpServer(found.existing) ? found.existing.url : null;
      const after = isRemoteMcpServer(server) ? server.url : null;
      // ...and to one sign-in app with its scopes; a new secret for the same app keeps it.
      const app = (entry: StoredMcpServer) => isRemoteMcpServer(entry) && entry.oauth
        ? JSON.stringify([entry.oauth.clientId, entry.oauth.scopes ?? []]) : null;
      if (before !== after || app(found.existing) !== app(server)
        || (after && mcpOAuth.authState(name, after) === "needs-sign-in")) mcpOAuth.forget(name);
      return saved(200);
    }),
    setEnabled: (name, enabled) => write(() => {
      const found = stored(name);
      if (!found.existing) return found.result!;
      persistMcpServers({ ...found.current, [name]: { ...found.existing, enabled } });
      if (enabled) appCatalog?.serverChanged(name);
      health?.changed(name);
      return saved(200);
    }),
    restart: (name) => write(() => {
      const found = stored(name);
      if (!found.existing) return found.result!;
      health?.changed(name);
      return saved(200);
    }),
    setApps: (name, apps) => write(() => {
      const found = stored(name);
      if (!found.existing) return found.result!;
      const { apps: _apps, ...rest } = found.existing;
      persistMcpServers({ ...found.current, [name]: { ...rest, ...(apps ? {} : { apps: false }) } });
      if (apps) appCatalog?.serverChanged(name);
      return saved(200);
    }),
    remove: (name) => write(() => {
      const current = cfg.mcpServers ?? {};
      if (!Object.hasOwn(current, name)) return { status: 404, error: "MCP server not found." };
      const next = { ...current };
      delete next[name];
      persistMcpServers(next);
      mcpOAuth.forget(name);
      appCatalog?.forgetServer(name);
      return saved(200);
    }),
    test: async (name, { signal, asBot }) => {
      const raw = cfg.mcpServers?.[name];
      if (raw === undefined) return { status: 404, error: "MCP server not found." };
      const parsed = parseStoredMcpServer(name, raw);
      if (!parsed.ok) return { status: 400, error: parsed.error };
      if (parsed.server.runsOn) return { status: 409, error: runsElsewhere(parsed.server.runsOn) };
      if (mcpProbesInFlight >= MAX_CONCURRENT_MCP_PROBES) {
        return { status: 429, error: "Two MCP connection tests are already running." };
      }
      mcpProbesInFlight += 1;
      try {
        let target = parsed.server;
        const oauth = mcpOAuth;
        if (isRemoteMcpServer(target)) {
          target = { ...target, headers: { ...target.headers, ...postizKeyHeaders(cfg.postiz, name, target) } };
        }
        let sentSignIn = false;
        if (isRemoteMcpServer(target) && oauth.authState(name, target.url) === "signed-in") {
          const signedIn = (await withMcpSignIn({ [name]: target }, oauth))[name];
          if (signedIn) {
            target = { ...signedIn, enabled: target.enabled } as typeof target;
            sentSignIn = true;
          }
        }
        const options = { ...appCatalog?.probeOptions(name, parsed.server), ...(asBot ? { asBot } : isRemoteMcpServer(target) ? {} : { asBot: deps.probeAs?.(target) ?? {} }) };
        const viaBots = isRemoteMcpServer(target) ? deps.botsPath?.() ?? null : null;
        const result = viaBots && isRemoteMcpServer(target)
          ? await probeAsBots(viaBots, name, target, signal, options)
          : await probeMcpServer(target, undefined, signal, options);
        if (!result.ok && result.auth === "required" && isRemoteMcpServer(target)) {
          // Only a Bearer we sent and the server refused drops the sign-in; a probe that sent none must not sign anyone out.
          if (sentSignIn) oauth.markNeedsSignIn(name, target.url);
          else oauth.requireSignIn(name, target.url);
        }
        return { status: 200, body: result };
      } finally {
        mcpProbesInFlight -= 1;
      }
    },
  };
}
