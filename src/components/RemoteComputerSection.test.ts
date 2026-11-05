import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { isServerPairingLink, RemoteComputerSection } from "./RemoteComputerSection";

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("self-hosted server pairing links", () => {
  it.each([
    "https://bots.example.com/pair#code=ABCD-EFGH-JKLM",
    " https://custom.example.com:8443/pair/#code=ABCD%2DEFGH%2DJKLM ",
    "https://random.trycloudflare.com/pair#code=ABCDEFGHJKLM",
  ])("accepts a complete custom HTTPS link: %s", (link) => {
    expect(isServerPairingLink(link)).toBe(true);
  });

  it.each([
    "",
    "ABCD-EFGH-JKLM",
    "http://bots.example.com/pair#code=ABCD-EFGH-JKLM",
    "https:example.com/pair#code=ABCD-EFGH-JKLM",
    "https://user:secret@bots.example.com/pair#code=ABCD-EFGH-JKLM",
    "https://bots.example.com",
    "https://bots.example.com/pair",
    "https://bots.example.com/pair#code=",
    "https://bots.example.com/pair#code=%20",
    "https://bots.example.com/pair#code=%",
    "https://bots.example.com/other#code=ABCD-EFGH-JKLM",
    "https://bots.example.com/pair?code=ABCD-EFGH-JKLM",
    "https://bots.example.com/pair?code=secret#code=ABCD-EFGH-JKLM",
    "https://bots.example.com/pair#code=ABCD EFGH JKLM",
    "https://bots.example.com\\@other.example/pair#code=ABCD-EFGH-JKLM",
    "openmausbot://pair?code=123456",
  ])("rejects an incomplete, malformed, or insecure link: %s", (link) => {
    expect(isServerPairingLink(link)).toBe(false);
  });
});

describe("connecting to a server in Settings", () => {
  const render = (ogb?: unknown) => {
    vi.stubGlobal("window", { ogb });
    setLocale("en");
    return renderToStaticMarkup(createElement(RemoteComputerSection));
  };
  const place = { current: vi.fn(async () => ({ kind: "local" as const })), connect: vi.fn(), disconnect: vi.fn(), onChanged: vi.fn(() => () => {}) };

  it("asks for the server's pairing link and says how to get one", () => {
    const html = render({ place });
    expect(html).toContain("Server pairing link");
    expect(html).toContain(">npx openmausbot pair</code>");
    expect(html).toContain("12-character code");
    expect(html).toContain("custom domains and Cloudflare Tunnel");
    expect(html).toContain("Connect to server");
    expect(html).not.toContain("<select");
    expect(place.connect).not.toHaveBeenCalled();
  });

  it.each([undefined, { platform: "darwin" }])("offers nothing to do without the desktop app", (bridge) => {
    const html = render(bridge);
    expect(html).toContain("requires the installed app");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });
});
