import { describe, expect, it } from "vitest";
import { phonePairingLink } from "../../shared/pairing-link";
import {
  companionPairingRoute,
  companionPairingRoutePin,
  companionPairingRoutePinAvailable,
} from "./companion-pairing";

describe("companionPairingRoute", () => {
  const token = `omb_pair_${"a".repeat(43)}`;

  const decodedEndpoints = (link: string) => {
    const encoded = new URL(link).searchParams.get("endpoints");
    if (!encoded) return null;
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  };

  it("pins the tailnet route, and refuses one another tailnet address would replace", () => {
    const opened = {
      port: 8810,
      tailnetName: "mac.tail1234.ts.net",
      endpoints: [
        { url: "http://mac.tail1234.ts.net:8810", kind: "tailnet" as const, priority: 0 },
        { url: "http://192.168.1.42:8810", kind: "lan" as const, priority: 100 },
      ],
    };
    const pin = companionPairingRoutePin(opened, "tailscale");
    expect(pin?.protectedEndpoint).toEqual(opened.endpoints[0]);
    expect(companionPairingRoutePinAvailable(opened, pin!)).toBe(true);
    expect(companionPairingRoutePinAvailable({ endpoints: [opened.endpoints[1]!] }, pin!)).toBe(false);
    expect(companionPairingRoutePin(opened, "local")?.protectedEndpoint).toBeNull();
  });

  it("makes the explicitly selected LAN route first, with only local routes after it", () => {
    const route = companionPairingRoute({
      port: 8810,
      tailnetName: "mac.tail1234.ts.net",
      lan: "192.168.1.42",
      hosts: ["mac.tail1234.ts.net", "192.168.1.42", "openmausbot-aa.local"],
      endpoints: [
        { url: "http://mac.tail1234.ts.net:8810", kind: "tailnet", priority: 100 },
        { url: "http://192.168.1.42:8810", kind: "lan", priority: 200 },
        { url: "http://openmausbot-aa.local:8810", kind: "bonjour", priority: 300 },
      ],
    }, "local");

    expect(route?.address).toBe("192.168.1.42");
    expect(route?.port).toBe(8810);
    expect(route?.hosts).toEqual([
      "192.168.1.42",
      "openmausbot-aa.local",
    ]);
    const link = phonePairingLink({ ...route!, code: "004209", token });
    expect(new URL(link!).searchParams.get("address")).toBe("192.168.1.42:8810");
    expect(decodedEndpoints(link!)).toEqual([
      { url: "http://192.168.1.42:8810", kind: "lan", priority: 0 },
      { url: "http://openmausbot-aa.local:8810", kind: "bonjour", priority: 100 },
    ]);
  });

  it("keeps an explicitly selected Tailscale route off cleartext LAN fallbacks", () => {
    const route = companionPairingRoute({
      port: 8810,
      tailnetName: "mac.tail1234.ts.net",
      lan: "192.168.1.42",
      hosts: ["mac.tail1234.ts.net", "192.168.1.42", "openmausbot-aa.local"],
      endpoints: [
        { url: "http://mac.tail1234.ts.net:8810", kind: "tailnet", priority: 100 },
        { url: "http://192.168.1.42:8810", kind: "lan", priority: 200 },
        { url: "http://openmausbot-aa.local:8810", kind: "bonjour", priority: 300 },
      ],
    }, "tailscale");

    expect(route).toMatchObject({
      address: "mac.tail1234.ts.net",
      port: 8810,
      hosts: ["mac.tail1234.ts.net"],
    });
    const link = phonePairingLink({ ...route!, code: "004209", token });
    expect(decodedEndpoints(link!)).toEqual([
      { url: "http://mac.tail1234.ts.net:8810", kind: "tailnet", priority: 0 },
    ]);
    expect(new URL(link!).searchParams.get("hosts")).toBe("mac.tail1234.ts.net");
  });

  it("refuses a Tailscale label that is not a MagicDNS ts.net name", () => {
    expect(companionPairingRoute({
      port: 8810,
      tailnetName: "attacker.example",
      endpoints: [
        { url: "http://attacker.example:8810", kind: "tailnet", priority: 0 },
      ],
    }, "tailscale")).toBeNull();
  });

  it("refuses explicit local pairing when no LAN or Bonjour route exists", () => {
    expect(companionPairingRoute({
      port: 8810,
      tailnetName: "mac.tail1234.ts.net",
      hosts: ["mac.tail1234.ts.net"],
      endpoints: [
        { url: "http://mac.tail1234.ts.net:8810", kind: "tailnet", priority: 100 },
      ],
    }, "local")).toBeNull();
  });

  it("uses an advertised Bonjour route when no LAN address is available", () => {
    const route = companionPairingRoute({
      port: 8810,
      hosts: ["mac.tail1234.ts.net", "openmausbot-aa.local"],
      discovery: { advertising: true, name: "openmausbot-aa.local" },
      endpoints: [
        { url: "http://openmausbot-aa.local:8810", kind: "bonjour", priority: 300 },
      ],
    }, "local");

    expect(route?.address).toBe("openmausbot-aa.local");
    expect(route?.hosts?.[0]).toBe("openmausbot-aa.local");
    expect(route?.endpoints?.map((endpoint) => endpoint.kind)).toEqual(["bonjour"]);
  });

  it("does not treat an inactive synthetic Bonjour name as a reachable local route", () => {
    expect(companionPairingRoute({
      port: 8810,
      hosts: ["mac.tail1234.ts.net", "openmausbot-aa.local"],
      discovery: { advertising: false, name: "openmausbot-aa.local" },
      endpoints: [
        { url: "http://openmausbot-aa.local:8810", kind: "bonjour", priority: 300 },
      ],
    }, "local")).toBeNull();
  });
});
