import * as boat from "../boat.ts";
import type { ComputerControl } from "../computer-control.ts";
import { isValidSshAlias, type AppConfig } from "../config.ts";
import type { Store } from "../store.ts";
import * as vps from "../vps-computer.ts";
import { vpsAliasesInPlay } from "../vps-hosts.ts";
import type { RemoteComputerProvider } from "./config.ts";
import { createComputerFramesRoutes } from "./computer-frames.ts";
import { createComputerUsageRoutes } from "./computer-usage.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ComputerRouteDeps {
  store: Pick<Store, "bot" | "bots">;
  cfg: AppConfig;
  computerControl: Pick<ComputerControl, "snapshot">;
  computerProviderConfigTransitions: Pick<Set<RemoteComputerProvider>, "has">;
  managedBoatOwners(): boat.ManagedBoatOwner[];
  providerTransitionMessage(provider: RemoteComputerProvider): string;
  botHasActiveTurn(botId: string): boolean;
  claimBoatInventoryRequest(boxId: string): () => void;
  claimManagedBoatMutation(instance: boat.ManagedBoatInventoryInstance): () => void;
  claimManagedVpsMutation(containerName: string): () => void;
}

export function createComputerRoutes(deps: ComputerRouteDeps): RouteHandler {
  const {
    store, cfg, computerProviderConfigTransitions, managedBoatOwners, providerTransitionMessage,
    claimBoatInventoryRequest, claimManagedBoatMutation, claimManagedVpsMutation,
  } = deps;
  const usage = createComputerUsageRoutes(deps);
  const frames = createComputerFramesRoutes(deps);
  return async (context) => {
    if (await usage(context) !== PASS) return;
    if (await frames(context) !== PASS) return;
    const { req, res, path, method, json, readBody } = context;
    let m: RegExpMatchArray | null = null;
    // Read-only; lifecycle changes are revalidated against a fresh provider listing. The path keeps its historical /boxes segment.
    if (method === "GET" && path === "/api/computers/boxes") {
      res.setHeader("cache-control", "private, no-store");
      return json(res, 200, await boat.listManagedBoats(cfg, managedBoatOwners()));
    }
    m = path.match(/^\/api\/computers\/boxes\/([\w-]+)\/(sleep|delete)$/);
    if (m && method === "POST") {
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req);
      if (computerProviderConfigTransitions.has("box")) {
        return json(res, 409, { error: providerTransitionMessage("box") });
      }
      const releaseInventoryRequest = claimBoatInventoryRequest(m[1]);
      try {
        const owners = managedBoatOwners();
        if (m[2] === "sleep") {
          return json(res, 200, await boat.sleepManagedBoat(cfg, owners, m[1], claimManagedBoatMutation));
        }
        if (typeof body?.confirmName !== "string" || body.confirmName.length > 100) {
          return json(res, 400, { error: "confirmName must be the cloud computer name shown in Settings" });
        }
        return json(res, 202, await boat.deleteManagedBoat(
          cfg,
          owners,
          m[1],
          body.confirmName,
          claimManagedBoatMutation,
        ));
      } finally {
        releaseInventoryRequest();
      }
    }
    if (method === "GET" && path === "/api/computers/vps") {
      res.setHeader("cache-control", "private, no-store");
      // Computers live on the default server and on each bot's own: list them all, tagged by alias.
      return json(res, 200, await vps.listManagedVpsComputers(
        cfg,
        managedBoatOwners(),
        undefined,
        vpsAliasesInPlay(cfg, store.bots),
      ));
    }
    m = path.match(/^\/api\/computers\/vps\/([\w-]+)\/remove$/);
    if (m && method === "POST") {
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req);
      if (computerProviderConfigTransitions.has("vps")) {
        return json(res, 409, { error: providerTransitionMessage("vps") });
      }
      if (typeof body?.confirmName !== "string" || body.confirmName.length > 100) {
        return json(res, 400, { error: "confirmName must be the VPS computer name shown in Settings" });
      }
      const alias = body?.alias;
      if (alias !== undefined && !isValidSshAlias(alias)) {
        return json(res, 400, { error: "alias must be a simple SSH config alias" });
      }
      // An explicit alias may only name a server the inventory scans: anything else would open
      // docker-over-SSH to an arbitrary host from the user's SSH config.
      if (alias !== undefined && !vpsAliasesInPlay(cfg, store.bots).includes(alias)) {
        return json(res, 400, { error: "alias must be the default server or a bot's own SSH alias" });
      }
      const releaseComputerLifecycle = claimManagedVpsMutation(m[1]);
      try {
        return json(res, 200, await vps.removeManagedVpsComputer(
          alias ? { vps: { sshAlias: alias } } : cfg,
          managedBoatOwners(),
          m[1],
          body.confirmName,
        ));
      } finally {
        releaseComputerLifecycle();
      }
    }

    return PASS;
  };
}
