import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(), api: fixture.api }));

import { keyEntry, type KeyId } from "./key-catalog";
import { saveKey } from "./key-save";

const SLOTS: Array<[KeyId, string]> = [
  ["openai", "openaiApiKey"], ["anthropic", "anthropicApiKey"], ["openrouter", "openrouterApiKey"], ["mistral", "mistralApiKey"], ["cerebras", "cerebrasApiKey"],
  ["groq", "groqApiKey"], ["greenference", "greenferenceApiKey"], ["meta", "metaApiKey"], ["deepseek", "deepseekApiKey"], ["openaiCompat", "openaiCompatApiKey"],
];

beforeEach(() => fixture.api.mockReset().mockResolvedValue({}));
afterEach(() => vi.unstubAllGlobals());

describe("saving an AI provider key", () => {
  it.each(SLOTS)("keeps %s in the desktop's encrypted store, and removes it there too", async (id, slot) => {
    const setCredential = vi.fn().mockResolvedValue({});
    vi.stubGlobal("window", { ogb: { setCredential } });
    await saveKey(keyEntry(id).target!, "fixture-key", false);
    await saveKey(keyEntry(id).target!, "", false);
    expect(setCredential.mock.calls).toEqual([[slot, "fixture-key"], [slot, ""]]);
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("carries the first Anthropic key's choice to leave Claude sign-ins alone", async () => {
    const setCredential = vi.fn().mockResolvedValue({});
    vi.stubGlobal("window", { ogb: { setCredential } });
    await saveKey(keyEntry("anthropic").target!, "fixture-key", true);
    expect(setCredential).toHaveBeenCalledExactlyOnceWith("anthropicApiKey", "fixture-key", { everyClaudeBot: false });
  });

  it.each(SLOTS)("uses the server's config for %s with no desktop store, as a browser on a server has none", async (id) => {
    vi.stubGlobal("window", {});
    await saveKey(keyEntry(id).target!, "fixture-key", false);
    expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/config", { method: "PUT", body: JSON.stringify(keyEntry(id).target!.patch("fixture-key", false)) });
  });

});
