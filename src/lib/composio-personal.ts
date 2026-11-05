import { api } from "@/state/store";

export const COMPOSIO_PERSONAL_SERVER = "composio-personal";
const COMPOSIO_PERSONAL_URL = "https://connect.composio.dev/mcp";
const KEY_HEADER = "x-consumer-api-key";
const TEST_TIMEOUT_MS = 30_000;

type Request = typeof api;
export type ComposioPersonalResult = { ok: true } | { ok: false; error: string };

export function looksLikeComposioPersonalKey(key: string): boolean {
  return /^ck_\S+$/.test(key.trim());
}

/** Saves a person's own Composio key (ck_…) as the composio-personal MCP server, kept like any MCP header secret.
 * New servers are saved off; this one is switched on only once Composio accepted the key. */
export async function saveComposioPersonalKey(key: string, request: Request = api): Promise<ComposioPersonalResult> {
  const server = { type: "http", url: COMPOSIO_PERSONAL_URL, headers: { [KEY_HEADER]: key.trim() } };
  const path = `/api/mcp/servers/${COMPOSIO_PERSONAL_SERVER}`;
  const { servers = [] } = await request<{ servers?: Array<{ name: string }> }>("/api/mcp/servers");
  if (servers.some((saved) => saved.name === COMPOSIO_PERSONAL_SERVER)) {
    await request(path, { method: "PUT", body: JSON.stringify(server) });
  } else {
    await request("/api/mcp/servers", { method: "POST", body: JSON.stringify({ name: COMPOSIO_PERSONAL_SERVER, ...server }) });
  }
  const probe = await request<{ ok?: boolean; error?: string }>(`${path}/test`, { method: "POST", body: "{}", timeoutMs: TEST_TIMEOUT_MS });
  if (probe?.ok !== true) return { ok: false, error: probe?.error ?? "" };
  await request(path, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
  return { ok: true };
}
