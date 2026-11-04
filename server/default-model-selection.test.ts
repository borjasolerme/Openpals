import { describe, expect, it } from "vitest";

import type { ModelCatalog, ModelSelection, ProviderSnapshot } from "./contracts.ts";
import { readyToRun, selectDefaultModelSelection, withInstanceConfig, withNewBotEffort, type SelectableInstance } from "./default-model-selection.ts";

const codex = {
  instanceId: "codex",
  driverKind: "codex",
  snapshot: { state: "available", authenticated: true } satisfies ProviderSnapshot,
  models: {
    default: "codex-default",
    options: [{ id: "codex-default", label: "Default" }, { id: "selected-model", label: "Selected" }],
  } satisfies ModelCatalog,
  capabilities: { effortLevels: ["low", "high"] as const },
};
const claude = {
  instanceId: "claude",
  driverKind: "claudeAgent",
  snapshot: { state: "available", authenticated: true } satisfies ProviderSnapshot,
  models: { default: "claude-default", options: [{ id: "claude-default", label: "Claude" }] },
};

describe("new bot default model selection", () => {
  it("accepts a configured API-key provider", () => {
    const instance = { ...codex, instanceId: "mistral", driverKind: "mistral", access: "api" as const };
    const preferred = { instanceId: "mistral", model: "selected-model" };
    expect(selectDefaultModelSelection([instance], preferred)).toEqual(preferred);
  });
  it("keeps a saved custom endpoint even when its account sign-in is false", () => {
    const instance = { ...codex, access: "custom" as const, snapshot: { state: "available", authenticated: false } satisfies ProviderSnapshot };
    const preferred = { instanceId: "codex", model: "selected-model" };
    expect(selectDefaultModelSelection([claude, instance], preferred)).toEqual(preferred);
  });
  it("preserves an intentional variant for ACP validation, including variants absent from the preview catalog", () => {
    const preferred = { instanceId: "codex", model: "selected-model", variant: "default" };
    expect(selectDefaultModelSelection([{ ...codex, capabilities: { modelVariants: true } }], preferred))
      .toEqual(preferred);
    expect(selectDefaultModelSelection([codex], preferred)).toEqual({ instanceId: "", model: "" });
    expect(preferred.variant).toBe("default");
  });
  it.each(["low", "high"] as const)("honors the configured provider, model, and supported %s effort ahead of the Claude preference", (effort) => {
    const preferred = { instanceId: "codex", model: "selected-model", effort };
    const selection = selectDefaultModelSelection([claude, codex], preferred);
    expect(selection).toEqual(preferred);
    expect(selection).not.toBe(preferred);
  });

  it.each([
    { label: "missing capabilities", capabilities: undefined },
    { label: "no effort control", capabilities: {} },
    { label: "empty effort list", capabilities: { effortLevels: [] } },
    { label: "changed effort support", capabilities: { effortLevels: ["low"] as const } },
  ])("omits stale effort for $label without changing the provider, model, or saved preference", ({ capabilities }) => {
    const preferred = { instanceId: "codex", model: "selected-model", effort: "high" as const };
    const selection = selectDefaultModelSelection([
      { ...claude, capabilities: { effortLevels: ["high"] } },
      { ...codex, capabilities },
    ], preferred);
    expect(selection).toEqual({ instanceId: "codex", model: "selected-model" });
    expect(selection).not.toHaveProperty("effort");
    expect(preferred.effort).toBe("high");
  });

  it("accepts the provider default even when it is not repeated in its options", () => {
    expect(selectDefaultModelSelection(
      [{ ...codex, models: { default: "codex-default", options: [] } }],
      { instanceId: "codex", model: "codex-default" },
    )).toEqual({ instanceId: "codex", model: "codex-default" });
  });

  it.each([
    { label: "missing provider", instances: [claude] },
    { label: "unavailable provider", instances: [claude, { ...codex, snapshot: { state: "unavailable" as const } }] },
    { label: "signed-out provider", instances: [claude, { ...codex, snapshot: { state: "available" as const, authenticated: false } }] },
    { label: "disabled provider", instances: [claude, { ...codex, enabled: false }] },
    { label: "removed model", instances: [claude, { ...codex, models: { default: "new-model", options: [] } }] },
  ])("returns setup for a saved $label without changing provider", ({ instances }) => {
    expect(selectDefaultModelSelection(instances, { instanceId: "codex", model: "selected-model" }))
      .toEqual({ instanceId: "", model: "" });
  });

  it("keeps the existing Claude preference when no default was saved", () => {
    expect(selectDefaultModelSelection([codex, claude])).toEqual({ instanceId: "claude", model: "claude-default" });
    expect(selectDefaultModelSelection([codex])).toEqual({ instanceId: "codex", model: "codex-default" });
    expect(selectDefaultModelSelection([])).toEqual({ instanceId: "", model: "" });
  });

  it("treats a fully empty saved default as unset, but keeps incomplete choices intentional", () => {
    expect(selectDefaultModelSelection([codex], { instanceId: "", model: "" }))
      .toEqual({ instanceId: "codex", model: "codex-default" });
    for (const preferred of [{ instanceId: "codex", model: "" }, { instanceId: "", model: "selected-model" }]) {
      expect(selectDefaultModelSelection([claude, codex], preferred)).toEqual({ instanceId: "", model: "" });
    }
  });

  it("skips empty model catalogs instead of choosing an unusable preferred provider", () => {
    const empty = { ...claude, models: { default: "", options: [] } };
    expect(selectDefaultModelSelection([empty, codex])).toEqual({ instanceId: "codex", model: "codex-default" });
    expect(selectDefaultModelSelection([empty])).toEqual({ instanceId: "", model: "" });
    expect(selectDefaultModelSelection([{ ...empty, models: { default: " ", options: [{ id: "", label: "Empty" }] } }]))
      .toEqual({ instanceId: "", model: "" });
  });

  it("uses the first nonempty model when a configured catalog has no default", () => {
    const models = { default: "", options: [{ id: "", label: "Empty" }, { id: " ", label: "Blank" }, { id: "usable-model", label: "Usable" }] };
    expect(selectDefaultModelSelection([{ ...claude, models }, codex]))
      .toEqual({ instanceId: "claude", model: "usable-model" });
    expect(selectDefaultModelSelection([{ ...codex, models: { default: "catalog-default", options: [] } }]))
      .toEqual({ instanceId: "codex", model: "catalog-default" });
  });

  it("never automatically chooses a disabled engine, even for signed-out setup", () => {
    const disabled = { ...claude, enabled: false };
    expect(readyToRun(disabled)).toBe(false);
    expect(selectDefaultModelSelection([disabled, codex])).toEqual({ instanceId: "codex", model: "codex-default" });
    expect(selectDefaultModelSelection([disabled])).toEqual({ instanceId: "", model: "" });
    const signedOutCodex = { ...codex, snapshot: { state: "available", authenticated: false } satisfies ProviderSnapshot };
    expect(selectDefaultModelSelection([disabled, signedOutCodex])).toEqual({ instanceId: "codex", model: "codex-default" });
  });

  it("prefers an engine that can run a turn now over a signed-out Claude", () => {
    const signedOut = { ...claude, snapshot: { state: "available", authenticated: false } satisfies ProviderSnapshot };
    expect(selectDefaultModelSelection([signedOut, codex])).toEqual({ instanceId: "codex", model: "codex-default" });
    expect(selectDefaultModelSelection([codex, signedOut])).toEqual({ instanceId: "codex", model: "codex-default" });
    // Nothing can run yet: the first available engine, Claude first.
    const codexOut = { ...codex, snapshot: { state: "available", authenticated: false } satisfies ProviderSnapshot };
    expect(selectDefaultModelSelection([codexOut, signedOut])).toEqual({ instanceId: "claude", model: "claude-default" });
    const custom = { ...codexOut, instanceId: "router", access: "custom" as const };
    expect(selectDefaultModelSelection([signedOut, custom])).toEqual({ instanceId: "router", model: "codex-default" });
  });
});

describe("new bot default: one ranking with the welcome, tested AIs first", () => {
  const ready = (instanceId: string, driverKind: string, model: string, snapshot: Partial<ProviderSnapshot> = {}): SelectableInstance => ({
    instanceId, driverKind, snapshot: { state: "available", authenticated: true, ...snapshot }, models: { default: model, options: [{ id: model, label: model }] },
  });
  const grok = ready("grok", "grokAgent", "grok-default");
  const kimi = ready("kimi", "kimiAgent", "kimi-default");
  const chatgpt = ready("chatgpt", "codex", "gpt-default", { chatgptPlan: true });
  const claudeReady = ready("claude", "claudeAgent", "claude-default");
  const openCodeFree = ready("opencodeGo", "opencodeGo", "opencode/big-pickle", { freeFallback: true });
  const pick = (instances: SelectableInstance[], context = {}) => selectDefaultModelSelection(instances, undefined, context).instanceId;

  it("picks Claude over Grok even though Grok comes first in the app's list", () => {
    expect(pick([grok, kimi, claudeReady])).toBe("claude");
  });

  it("picks a ChatGPT plan over Grok", () => {
    expect(pick([grok, kimi, chatgpt])).toBe("chatgpt");
  });

  it("picks OpenCode on free models only after every other ready AI, and when it is the only one", () => {
    for (const other of [grok, kimi, chatgpt, claudeReady]) expect(pick([openCodeFree, other])).toBe(other.instanceId);
    expect(pick([openCodeFree])).toBe("opencodeGo");
    expect(selectDefaultModelSelection([openCodeFree])).toEqual({ instanceId: "opencodeGo", model: "opencode/big-pickle" });
  });

  it("always keeps a saved default, over the ranking and over any test", () => {
    const saved = { instanceId: "opencodeGo", model: "opencode/big-pickle" };
    expect(selectDefaultModelSelection([claudeReady, openCodeFree], saved, { answered: (instance) => instance.instanceId === "claude" }))
      .toEqual(saved);
    expect(selectDefaultModelSelection([claudeReady, grok], { instanceId: "grok", model: "grok-default" }, { answered: () => false }))
      .toEqual({ instanceId: "grok", model: "grok-default" });
  });

  it("moves off an AI that failed its test to the best one that answered, and keeps the ranking until a test says otherwise", () => {
    const failed = (...ids: string[]) => (instance: SelectableInstance) => ids.includes(instance.instanceId) ? false : undefined;
    expect(pick([grok, claudeReady, chatgpt], { answered: failed("claude") })).toBe("chatgpt");
    expect(pick([grok, claudeReady, chatgpt], { answered: (instance: SelectableInstance) => instance.instanceId === "claude" ? false : instance.instanceId === "grok" })).toBe("grok");
    expect(pick([grok, claudeReady], { answered: () => undefined })).toBe("claude");
    // Nothing answered: the ranking still decides, so a new bot is never left without an AI.
    expect(pick([grok, claudeReady], { answered: () => false })).toBe("claude");
    // The free backup that answered beats a real AI that didn't.
    expect(pick([claudeReady, openCodeFree], { answered: (instance: SelectableInstance) => instance.instanceId === "opencodeGo" ? true : false })).toBe("opencodeGo");
  });

  it("never prefers the free backup to a real AI that hasn't been tested yet, or can't be", () => {
    const backupAnswered = (instance: SelectableInstance) => instance.instanceId === "opencodeGo" ? true : undefined;
    expect(pick([claudeReady, openCodeFree], { answered: backupAnswered })).toBe("claude");
    expect(pick([ready("muse", "museCode", "muse-default"), openCodeFree], { answered: backupAnswered })).toBe("muse");
  });
});

describe("new bot effort default", () => {
  const selection: ModelSelection = { instanceId: "codex", model: "codex-default" };

  it("adds the workspace effort when the engine offers it", () => {
    expect(withNewBotEffort(selection, "high", ["low", "high"])).toEqual({ ...selection, effort: "high" });
  });

  it("keeps the caller's explicit effort or model variant", () => {
    expect(withNewBotEffort({ ...selection, effort: "low" }, "high", ["low", "high"])).toEqual({ ...selection, effort: "low" });
    const variant = { instanceId: "opencodeGo", model: "provider/model", variant: "minimal" };
    expect(withNewBotEffort(variant, "high", ["high"])).toEqual(variant);
  });

  it("sends no level when none is configured or the engine does not offer it", () => {
    expect(withNewBotEffort(selection, undefined, ["high"])).toEqual(selection);
    expect(withNewBotEffort(selection, "max", ["low", "high"])).toEqual(selection);
    expect(withNewBotEffort(selection, "high", undefined)).toEqual(selection);
  });
});

describe("a hidden provider", () => {
  it("drops out of every selectable list, and an unhidden one comes back", () => {
    const instances = [{ instanceId: "claude" }, { instanceId: "hermes" }] as unknown as SelectableInstance[];
    expect(withInstanceConfig(instances, { hermes: { driver: "fake", hidden: true } }).map((instance) => instance.instanceId)).toEqual(["claude"]);
    expect(withInstanceConfig(instances, { hermes: { driver: "fake" } }).map((instance) => instance.instanceId)).toEqual(["claude", "hermes"]);
  });
});

