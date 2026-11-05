// Bots receive team memory in their system context; a person edits it here.
import { z } from "zod";

import { TEAM_MEMORY_KINDS, TeamMemory, TeamMemoryConflict, type TeamMemoryKind } from "../team-memory.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface TeamMemoryRouteDeps {
  teamMemory: Pick<TeamMemory, "list" | "propose" | "resolve" | "update" | "remove" | "promptSelection">;
}

export function createTeamMemoryRoutes(deps: TeamMemoryRouteDeps): RouteHandler {
  const { teamMemory } = deps;
  const listing = () => ({ entries: teamMemory.list(), loadedIds: teamMemory.promptSelection().loadedIds });
  return async ({ req, res, url, path, method, json, readBody }) => {
    if (path === "/api/team-memory" && (method === "GET" || method === "POST")) {
      if (method === "GET") return json(res, 200, listing());
      const body = await readBody(req);
      if (!body || typeof body !== "object" || !(TEAM_MEMORY_KINDS as readonly string[]).includes(String(body.kind))) {
        return json(res, 400, { error: `kind must be one of ${TEAM_MEMORY_KINDS.join(", ")}` });
      }
      try {
        const input = TeamMemory.normalize({ kind: body.kind as TeamMemoryKind, name: String(body.name ?? ""), detail: String(body.detail ?? ""), aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : undefined, key: typeof body.key === "string" ? body.key : undefined });
        if (teamMemory.list().some(entry => entry.status === "accepted" && entry.key === input.key)) return json(res, 409, { error: "This fact already exists. Edit its current revision instead of adding a replacement." });
        const proposed = teamMemory.propose(input, { botId: "", botName: "you", threadId: "", at: Date.now() });
        if (proposed.status === "proposed") teamMemory.resolve(proposed.entry.id, "accept");
        return json(res, 201, listing());
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    const m = path.match(/^\/api\/team-memory\/([\w-]+)$/);
    if (m && (method === "PATCH" || method === "DELETE")) {
      const body = method === "DELETE" ? { expectedRevision: url.searchParams.get("revision") } : await readBody(req);
      if (!body || typeof body.expectedRevision !== "string" || !body.expectedRevision) return json(res, 428, { error: "Reload this memory and send its expectedRevision." });
      try {
        if (method === "DELETE") {
          if (!teamMemory.remove(m[1], body.expectedRevision)) return json(res, 404, { error: "no such entry" });
        } else if (body.accept === true) {
          if (!teamMemory.resolve(m[1], "accept", body.expectedRevision).claimed) return json(res, 404, { error: "no such entry" });
        } else {
          const parsed = z.object({ name: z.string().optional(), detail: z.string().optional(), aliases: z.array(z.string()).optional(),
            kind: z.enum(TEAM_MEMORY_KINDS).optional(), pinned: z.boolean().optional(), key: z.string().optional() }).safeParse(body);
          if (!parsed.success) return json(res, 400, { error: "Invalid memory edit" });
          if (!teamMemory.update(m[1], parsed.data, body.expectedRevision)) return json(res, 404, { error: "no such entry" });
        }
        return json(res, 200, listing());
      } catch (error) {
        return json(res, error instanceof TeamMemoryConflict ? 409 : 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return PASS;
  };
}
