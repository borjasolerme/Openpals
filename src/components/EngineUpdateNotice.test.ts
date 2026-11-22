import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EngineUpdateNotice } from "./EngineSetup";
import { StoreProvider, type InstanceInfo } from "@/state/store";

const update = {
  title: "Update Codex for GPT-6 Astra",
  message: "This Codex version predates Astra support. Update it, then refresh models.",
  command: "codex update",
};

afterEach(() => vi.unstubAllGlobals());

describe("EngineUpdateNotice", () => {
  const instance: InstanceInfo = {
    instanceId: "codex", driverKind: "codex", displayName: "Codex",
    models: { default: "fixture-model", options: [] }, snapshot: { state: "available" },
    install: { server: { package: "@openai/codex" } },
  };

  it("uses the terminal action when the app installer cannot install the offered update", () => {
    const newerThanPin = { ...update, serverInstall: false as const };
    const markup = renderToStaticMarkup(createElement(StoreProvider, null,
      createElement(EngineUpdateNotice, { update: newerThanPin, instance })));
    expect(markup).toContain("codex update");
    expect(markup).toContain('aria-label="Copy command"');
    expect(markup).not.toContain("Update Codex here</button>");
  });

  it("keeps the one-click updater for an update the app installer can supply", () => {
    const markup = renderToStaticMarkup(createElement(StoreProvider, null,
      createElement(EngineUpdateNotice, { update, instance })));
    expect(markup).toContain("Update Codex here</button>");
  });

  it("keeps the terminal command visible and copyable without blocking the model list", () => {
    const markup = renderToStaticMarkup(createElement(EngineUpdateNotice, { update }));

    expect(markup).toContain("data-engine-update-notice");
    expect(markup).toContain("Update Codex for GPT-6 Astra");
    expect(markup).toContain("codex update");
    expect(markup).toContain('aria-label="Copy command"');
  });

  it("offers the native Terminal action when the desktop bridge supports it", () => {
    vi.stubGlobal("window", { ogb: { openInstallTerminal: vi.fn() } });

    const markup = renderToStaticMarkup(createElement(EngineUpdateNotice, { update }));

    expect(markup).toContain('aria-label="Open update in Terminal"');
    expect(markup).toContain("Terminal");
  });
});
