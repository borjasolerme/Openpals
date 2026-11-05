// A loopback Composio project for the connected-apps tests: one Tool Router Session with its toolkits and connected
// accounts, and the Session's MCP endpoint, which answers the Google tools the way Composio's multi-execute tool does, as
// the default connected account. Launch the server with `env` so the project key only ever reaches this fake.
import { createServer } from "node:http";

import { CALENDAR_LIST_TOOL, CALENDARS_TOOL, GMAIL_FETCH_TOOL, GMAIL_MESSAGE_TOOL, GMAIL_PROFILE_TOOL, GMAIL_THREAD_TOOL } from "../connected-reads.ts";

export interface FakeConnectedApps {
  apiKey: string;
  /** What a server needs to use this project: its key, the project API and the toolkit catalog, all on loopback. */
  env: { COMPOSIO_API_KEY: string; OMB_COMPOSIO_API: string; OMB_COMPOSIO_TOOLKITS_API: string };
  connected: Record<string, boolean>;
  address: string;
  /** Google Calendar event resources of the primary calendar. */
  events: unknown[];
  /** Composio GMAIL_FETCH_EMAILS messages. */
  emails: unknown[];
  calendars: unknown[];
  /** A thread's messages by thread id; unset, the inbox entries with that thread id. */
  threads: Record<string, unknown[]>;
  /** While set, every Gmail tool answers with this error, as Composio passes Google's on. */
  gmailError?: string;
  /** Every tool call that reached the Session, with its arguments and the whole multi-execute item. */
  calls: Array<{ tool: string; arguments: unknown; item: Record<string, unknown> }>;
  close(): Promise<void>;
}

type Frame = { id?: unknown; method?: string; params?: { name?: string; arguments?: { tools?: Array<Record<string, unknown>> } } };

class ToolFailure extends Error {}
// Google's own answer for a message that is gone, as Composio passes it on.
const NOT_FOUND = "Requested entity was not found.";
const API_KEY = "ak_fake_connected_apps";
const SESSION_ID = "trs_fake_connected_apps";
const SESSION = `/api/v3.1/tool_router/session/${SESSION_ID}`;
const MCP = `/tool_router/${SESSION_ID}/mcp`;
const field = (value: unknown, name: string): unknown => (value && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined);

export async function startFakeConnectedApps(): Promise<FakeConnectedApps> {
  const fake: Omit<FakeConnectedApps, "apiKey" | "env" | "close"> = {
    connected: { gmail: true, googlecalendar: true }, address: "me@example.test", events: [], emails: [], calls: [], threads: {},
    calendars: [{ id: "me@example.test", primary: true, accessRole: "owner", selected: true }],
  };
  let origin = "";
  let userId = "";

  function answer(slug: string, args: unknown): unknown {
    if (slug.startsWith("GMAIL_") && fake.gmailError) throw new ToolFailure(fake.gmailError);
    if (slug === CALENDAR_LIST_TOOL) return { items: fake.events };
    if (slug === CALENDARS_TOOL) return { items: fake.calendars };
    if (slug === GMAIL_FETCH_TOOL) {
      const after = Number(/after:(\d+)/.exec(String(field(args, "query")))?.[1] ?? 0) * 1000;
      return { messages: fake.emails.filter((message) => Date.parse(String(field(message, "messageTimestamp"))) >= after) };
    }
    if (slug === GMAIL_PROFILE_TOOL) return { emailAddress: fake.address };
    if (slug === GMAIL_MESSAGE_TOOL) {
      const message = fake.emails.find((one) => field(one, "messageId") === field(args, "message_id"));
      if (!message) throw new ToolFailure(NOT_FOUND);
      return message;
    }
    if (slug === GMAIL_THREAD_TOOL) {
      const threadId = field(args, "thread_id");
      return { messages: fake.threads[String(threadId)] ?? fake.emails.filter((message) => field(message, "threadId") === threadId) };
    }
    return { id: `fake-${slug.toLowerCase()}` };
  }

  const session = () => ({
    session_id: SESSION_ID,
    mcp: { type: "http", url: `${origin}${MCP}` },
    config: { user_id: userId, multi_account: { enable: true, max_accounts_per_toolkit: 5, require_explicit_selection: true }, auth_configs: {} },
  });
  const connectedSlugs = () => Object.keys(fake.connected).filter((slug) => fake.connected[slug]);
  const listed = (params: URLSearchParams, name: string) => (params.get(name) ?? "").split(",").filter(Boolean);

  function mcp(body: Frame): unknown {
    if (body.method === "initialize") {
      return { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fake-connected-apps", version: "1" } } };
    }
    if (body.method === "tools/list") {
      return { jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "COMPOSIO_MULTI_EXECUTE_TOOL", description: "Run app tools", inputSchema: { type: "object" } }] } };
    }
    if (body.method !== "tools/call") return { jsonrpc: "2.0", id: body.id, result: {} };
    const item = body.params?.name === "COMPOSIO_MULTI_EXECUTE_TOOL" ? body.params.arguments?.tools?.[0] ?? {} : { tool_slug: body.params?.name, arguments: body.params?.arguments };
    const slug = String(item.tool_slug ?? "");
    fake.calls.push({ tool: slug, arguments: item.arguments, item });
    let response: { successful: boolean; data: unknown; error: string | null };
    try {
      response = { successful: true, data: answer(slug, item.arguments), error: null };
    } catch (error) {
      if (!(error instanceof ToolFailure)) throw error;
      response = { successful: false, data: null, error: error.message };
    }
    const text = JSON.stringify({ successful: true, data: { results: [{ tool_slug: slug, response }] }, error: null });
    return { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }] } };
  }

  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url ?? "/", origin);
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.headers["x-api-key"] !== API_KEY) return reply(401, { error: { message: "invalid project key" } });
    if (req.method === "POST" && url.pathname === MCP) {
      if (body.method === "notifications/initialized") {
        res.writeHead(202);
        return res.end();
      }
      if (body.method === "initialize") res.setHeader("mcp-session-id", "fake-session");
      return reply(200, mcp(body as Frame));
    }
    if (req.method === "GET" && url.pathname === "/api/v3.1/auth_configs") return reply(200, { items: [] });
    if (req.method === "POST" && url.pathname === "/api/v3.1/tool_router/session") {
      userId = String(body.user_id);
      return reply(201, session());
    }
    if (url.pathname === SESSION && (req.method === "GET" || req.method === "PATCH")) return reply(userId ? 200 : 404, session());
    if (req.method === "GET" && url.pathname === `${SESSION}/toolkits`) {
      const asked = listed(url.searchParams, "toolkits");
      const slugs = asked.length ? asked : url.searchParams.get("is_connected") === "true" ? connectedSlugs() : Object.keys(fake.connected);
      return reply(200, { items: slugs.map((slug) => ({ slug, connected_account: fake.connected[slug] ? { id: `ca_${slug}`, status: "ACTIVE" } : null })) });
    }
    if (req.method === "POST" && url.pathname === `${SESSION}/link`) {
      return reply(201, { redirect_url: `https://connect.composio.dev/link/${String(body.toolkit)}` });
    }
    if (req.method === "GET" && url.pathname === "/api/v3.1/connected_accounts") {
      const asked = listed(url.searchParams, "toolkit_slugs");
      const slugs = connectedSlugs().filter((slug) => !asked.length || asked.includes(slug));
      return reply(200, { items: slugs.map((slug) => ({ id: `ca_${slug}`, status: "ACTIVE", toolkit: { slug } })) });
    }
    reply(404, { error: { message: "fake connected apps: unknown path" } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return Object.assign(fake, {
    apiKey: API_KEY,
    env: { COMPOSIO_API_KEY: API_KEY, OMB_COMPOSIO_API: `${origin}/api/v3.1`, OMB_COMPOSIO_TOOLKITS_API: `${origin}/api/v3` },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
