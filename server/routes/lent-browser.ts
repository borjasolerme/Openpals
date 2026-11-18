// This desktop lent to another server, running a bot's browser call in the person's own Chrome here
// (/api/desktop/lent-browser). Only main, on this machine, asks: it got the job from the lending server and checked it.
import { z } from "zod";

import { PASS, type RouteHandler } from "./table.ts";

const body = z.union([
  z.object({ key: z.string().regex(/^[A-Za-z0-9-]{1,80}$/), method: z.literal("tools/list") }).strict(),
  z.object({
    key: z.string().regex(/^[A-Za-z0-9-]{1,80}$/), method: z.literal("tools/call"),
    params: z.object({ name: z.string().regex(/^agent_browser_[a-z_]{1,60}$/).refine((name) => name !== "agent_browser_upload"), arguments: z.record(z.string(), z.unknown()).optional() }).strict(),
  }).strict(),
]);

export interface LentBrowserRouteDeps {
  run(key: string, method: "tools/list" | "tools/call", params: unknown): Promise<unknown>;
}

/** A tiny read that proves agent-browser reached the person's Chrome: the address of the tab it attached to. */
export const CHROME_CHECK = { name: "agent_browser_get_url", arguments: {} } as const;

export function createLentBrowserRoutes(deps: LentBrowserRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/desktop/lent-browser") return PASS;
    if (method !== "POST") return json(res, 405, { error: "Method not allowed" });
    if (auth.kind !== "loopback") return json(res, 403, { error: "Local desktop only" });
    const parsed = body.safeParse(await readBody(req, 1_000_000));
    if (!parsed.success) return json(res, 400, { error: "Invalid browser call" });
    try {
      const params = parsed.data.method === "tools/call" ? { name: parsed.data.params.name, arguments: parsed.data.params.arguments ?? {} } : {};
      return json(res, 200, { result: await deps.run(parsed.data.key, parsed.data.method, params) });
    } catch (error) {
      return json(res, 200, { result: { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] } });
    }
  };
}
