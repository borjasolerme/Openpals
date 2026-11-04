import { qrEndpoints, type CompanionEndpoint } from "../../shared/pairing-link";

export type { CompanionEndpoint, CompanionEndpointKind } from "../../shared/pairing-link";

export type CompanionPairingRouteMode = "local" | "tailscale";

export interface CompanionPairingRouteSource {
  port: number;
  addresses?: string[];
  tailscale?: string;
  tailnetName?: string;
  lan?: string | null;
  hosts?: string[];
  endpoints?: CompanionEndpoint[];
  discovery?: { advertising: boolean; name: string };
}

export interface CompanionPairingRoute {
  address: string;
  port: number;
  hosts?: string[];
  endpoints?: CompanionEndpoint[];
}

export interface CompanionPairingRoutePin {
  route: CompanionPairingRoute;
  protectedEndpoint: CompanionEndpoint | null;
}

const deduplicatedHosts = (hosts: string[]): string[] => {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const host of hosts) {
    const normalized = host.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }
  return values;
};

const directHTTPOrigin = (host: string, port: number): string => {
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${authority}:${port}`;
};

/** The QR's route for the chosen way to pair: the tailnet only, or this network only, never a mix. */
export function companionPairingRoute(
  source: CompanionPairingRouteSource,
  mode: CompanionPairingRouteMode,
): CompanionPairingRoute | null {
  const advertised = qrEndpoints(source.endpoints);
  if (mode === "tailscale") {
    let preferred = advertised.find((endpoint) => endpoint.kind === "tailnet") ?? null;
    if (!preferred && source.tailnetName?.trim()) {
      preferred = qrEndpoints([{
        url: directHTTPOrigin(source.tailnetName.trim(), source.port),
        kind: "tailnet",
        priority: 0,
      }])[0] ?? null;
    }
    if (!preferred) return null;

    const parsed = new URL(preferred.url);
    const address = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : 80;
    const otherTailnetRoutes = advertised.filter(
      (endpoint) => endpoint.url !== preferred.url && endpoint.kind === "tailnet",
    );
    const endpoints = [preferred, ...otherTailnetRoutes].map((endpoint, index) => ({
      ...endpoint,
      priority: index * 100,
    }));
    return {
      address,
      port,
      // Legacy clients walk `hosts` untyped: no cleartext LAN fallbacks where the one-time credential could be replayed.
      hosts: deduplicatedHosts([
        address,
        ...(source.hosts ?? []).filter((host) =>
          host.trim().toLowerCase().replace(/\.$/, "").endsWith(".ts.net")
        ),
      ]),
      endpoints,
    };
  }

  let preferred = advertised.find((endpoint) => endpoint.kind === "lan")
    ?? (source.discovery?.advertising
      ? advertised.find((endpoint) => endpoint.kind === "bonjour")
      : null)
    ?? null;
  if (!preferred) {
    const fallbackHost = source.lan?.trim()
      || (source.discovery?.advertising
        ? source.hosts?.find((host) => host.trim().toLowerCase().endsWith(".local"))
        : null);
    if (!fallbackHost) return null;
    preferred = qrEndpoints([{
      url: directHTTPOrigin(fallbackHost.trim(), source.port),
      kind: fallbackHost.trim().toLowerCase().endsWith(".local") ? "bonjour" : "lan",
      priority: 0,
    }])[0] ?? null;
  }
  if (!preferred) return null;

  const parsed = new URL(preferred.url);
  const address = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 80;
  const otherLocalRoutes = advertised.filter(
    (endpoint) => endpoint.url !== preferred.url && (endpoint.kind === "lan" || endpoint.kind === "bonjour"),
  );
  const endpoints = [preferred, ...otherLocalRoutes].map((endpoint, index) => ({
    ...endpoint,
    priority: index * 100,
  }));
  return {
    address,
    port,
    // Choosing local must not smuggle a tailnet route into legacy clients.
    hosts: deduplicatedHosts([
      address,
      ...(source.hosts ?? []).filter((host) =>
        !host.trim().toLowerCase().replace(/\.$/, "").endsWith(".ts.net")
      ),
    ]),
    endpoints,
  };
}

/** Frozen per QR, so a later refresh cannot reinterpret the one-time credential as Tailscale or plain LAN. */
export function companionPairingRoutePin(
  source: CompanionPairingRouteSource,
  mode: CompanionPairingRouteMode,
): CompanionPairingRoutePin | null {
  const route = companionPairingRoute(source, mode);
  if (!route) return null;

  const endpoints = qrEndpoints(route.endpoints);
  const protectedEndpoint = mode === "tailscale" ? endpoints.find((endpoint) => endpoint.kind === "tailnet") ?? null : null;
  if (mode === "tailscale" && !protectedEndpoint) return null;

  return {
    route: { ...route, endpoints },
    protectedEndpoint,
  };
}

/** No silent substitution of another protected endpoint: a new transport needs a fresh pairing credential. */
export function companionPairingRoutePinAvailable(
  source: Pick<CompanionPairingRouteSource, "endpoints">,
  pin: CompanionPairingRoutePin,
): boolean {
  if (!pin.protectedEndpoint) return true;
  return qrEndpoints(source.endpoints).some(
    (endpoint) => endpoint.kind === pin.protectedEndpoint?.kind
      && endpoint.url === pin.protectedEndpoint.url,
  );
}
