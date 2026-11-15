// A paired desktop lending its computer to this server (/api/shared-computers/*), the owner's list of those computers
// (/api/work-computers), and this desktop's own screen lock (/api/desktop/shared-computer-control). A main-process-only
// secret binds poll and results to the lending desktop; where lending is not taken the family 404s like a build without it.
import { z } from "zod";

import type { RequestAuth } from "../request-auth.ts";
import { responseGone, sharedComputerRegistration, type KnownLentComputer, type SharedComputers } from "../shared-computers.ts";
import type { SharedComputerControl } from "../shared-computer-control.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

/** Every lent computer here is the one owner's: lending is taken only where nobody else signs in. */
export const WORK_COMPUTER_OWNER = "owner";

const leaseBody = z.object({ id: z.string().uuid(), action: z.enum(["acquire", "release", "renew"]) });
const renameBody = z.object({ name: z.string().max(120) });
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SharedComputerRouteDeps {
  /** This server takes lending now: its one owner signs in here, nobody else. */
  accepted: () => boolean;
  computers: SharedComputers;
  sessionLive: (id: string) => boolean;
  environmentId: string;
  /** Renames and forgets a computer in the owner's list. */
  rename: (id: string, name: string) => boolean;
  forget: (id: string) => boolean;
  /** Takes a screenshot through a lent computer, for the owner's Test connection. */
  test: (id: string) => Promise<{ ok: true; image?: { mimeType: string; data: string } } | { ok: false; error: string }>;
  /** This computer's own screen lock, which the desktop that runs this server takes for a lent call it runs. */
  control: SharedComputerControl;
}

/** The owner on this server, or nobody: a desktop's chat-only pairing never sees or lends a computer. */
function isOwner(auth: RequestAuth): boolean {
  return auth.kind === "loopback" ? auth.trust !== "service" : auth.scopes.includes("admin");
}

export function createSharedComputerRoutes(deps: SharedComputerRouteDeps): RouteHandler {
  const owners = (): KnownLentComputer[] => deps.computers.known(WORK_COMPUTER_OWNER);
  return async ({ req, res, path, method, auth, json, readBody }: RouteContext): Promise<typeof PASS | void> => {
    if (path === "/api/desktop/shared-computer-control" && method === "POST") {
      // Grants nothing by itself: it only keeps local bot turns and a lent screen call from using the screen at once.
      if (auth.kind !== "loopback") return json(res, 403, { error: "Local desktop only" });
      const parsed = leaseBody.safeParse(await readBody(req, 1024));
      if (!parsed.success) return json(res, 400, { error: "Invalid computer lease" });
      if (parsed.data.action === "release") deps.control.release(parsed.data.id);
      else if (parsed.data.action === "renew") deps.control.renew(parsed.data.id);
      else {
        const busy = deps.control.acquire(parsed.data.id);
        if (busy) return json(res, 409, { error: busy, code: "bot" });
      }
      return json(res, 200, { ok: true });
    }
    if (path === "/api/work-computers" || path.startsWith("/api/work-computers/")) {
      if (!deps.accepted() || !isOwner(auth)) return json(res, 404, { error: `no route: ${method} ${path}` });
      if (method === "GET" && path === "/api/work-computers") return json(res, 200, { computers: owners() });
      const route = /^\/api\/work-computers\/([^/]+)(\/test)?$/.exec(path);
      const id = route?.[1] ?? "";
      if (!route || !ID.test(id) || !owners().some((computer) => computer.id === id)) return json(res, 404, { error: "No such computer" });
      if (route[2] && method === "POST") return json(res, 200, await deps.test(id));
      if (!route[2] && method === "PATCH") {
        const parsed = renameBody.safeParse(await readBody(req, 4096));
        if (!parsed.success) return json(res, 400, { error: "Give the computer a name of at most 120 characters" });
        deps.rename(id, parsed.data.name);
        return json(res, 200, { computer: owners().find((computer) => computer.id === id) ?? null });
      }
      if (!route[2] && method === "DELETE") { deps.forget(id); return json(res, 200, { ok: true }); }
      return json(res, 405, { error: "Method not allowed" });
    }
    if (path !== "/api/shared-computers" && !path.startsWith("/api/shared-computers/")) return PASS;
    if (method !== "POST" || !deps.accepted()) return json(res, 404, { error: `no route: ${method} ${path}` });
    if (auth.kind !== "session") return json(res, 403, { error: "Pair this desktop first" });
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Only a pairing that can change settings may lend a computer" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "JSON required" });
    const body = await readBody(req, 4_000_000);
    if (!deps.accepted()) return json(res, 404, { error: `no route: ${method} ${path}` });
    if (!deps.sessionLive(auth.session.id)) return json(res, 401, { error: "Session ended" });
    const secret = String(req.headers["x-omb-computer-secret"] ?? "");
    if (path === "/api/shared-computers/connect") {
      const parsed = sharedComputerRegistration.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Invalid computer registration" });
      if (parsed.data.environmentId !== deps.environmentId) return json(res, 409, { error: "This server changed. Pair again before lending this computer." });
      deps.computers.register(parsed.data, { session: auth.session.id, person: WORK_COMPUTER_OWNER }, secret);
      return json(res, 200, { ok: true });
    }
    const route = /^\/api\/shared-computers\/([\w-]+)\/(poll|lease|result|disconnect)$/.exec(path);
    if (!route) return json(res, 404, { error: "not found" });
    const [, id, action] = route;
    if (action === "poll") return json(res, 200, { job: await deps.computers.poll(id, auth.session.id, secret, responseGone(res)) });
    if (action === "lease") return json(res, 200, { active: deps.computers.liveJob(id, auth.session.id, secret, String(body?.jobId)) });
    if (action === "result") deps.computers.complete(id, auth.session.id, secret, String(body?.jobId), body?.result);
    if (action === "disconnect") deps.computers.disconnect(id, auth.session.id, secret, body?.paused === true);
    return json(res, 200, { ok: true });
  };
}
