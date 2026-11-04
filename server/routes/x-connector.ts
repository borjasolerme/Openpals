// GET /api/x/status: what the Apps page's X card shows: whether the X tools have the person's own treg key.
import type { XConnectorStatus } from "../../shared/x-connector.ts";
import type { ServiceCredential } from "../service-credentials.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const X_STATUS_PATH = "/api/x/status";

export interface XConnectorDeps {
  /** The X tools' credential: the person's own treg key (researchCredential). */
  credential: () => ServiceCredential | null;
}

export function createXConnectorRoutes(deps: XConnectorDeps): RouteHandler {
  return async (ctx) => {
    if (ctx.path !== X_STATUS_PATH) return PASS;
    if (ctx.method !== "GET") return void ctx.json(ctx.res, 405, { error: "Use GET." });
    const status: XConnectorStatus = { ownKey: deps.credential() !== null };
    ctx.res.setHeader("cache-control", "no-store");
    ctx.json(ctx.res, 200, status);
  };
}
