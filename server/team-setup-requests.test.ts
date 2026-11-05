import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TeamSetupRequestService } from "./team-setup-requests.ts";
import type { BotRecord, OptionCardData } from "./store.ts";
import type { TeamSetupRequest, TeamSetupResult } from "../shared/team-setup.ts";
import type { DirectApply } from "./direct-apply.ts";

function harness(caps?: Record<string, { driverKind: string; agentsMcp: boolean }>) {
  const bots: BotRecord[] = [];
  const messages: Array<{ id: string; role?: string; card?: OptionCardData }> = [];
  const bot = (id: string, overrides: Partial<BotRecord> = {}) => {
    const value: BotRecord = { id, threadId: `${id}-thread`, name: id, title: "", description: "", soul: "",
      notifications: true, color: "blue", unread: false, createdAt: 1, resumeCursors: {}, modelSelection: { instanceId: "claude", model: "sonnet" },
      ...overrides };
    bots.push(value); return value;
  };
  const chief = bot("Clive", { chiefOfStaff: true });
  const peer = bot("Ada");
  const apply = vi.fn((request: TeamSetupRequest): TeamSetupResult => {
    const result: TeamSetupResult = { state: "applied", bots: request.operations.map((op) => {
      const target = bots.find((item) => item.id === op.botId) ?? bot(op.botId);
      Object.assign(target, op.fields);
      return { id: target.id, name: target.name, action: op.action === "create" ? "created" : "updated" };
    }) };
    chief.lastTeamSetupReceipt = { requestId: request.requestId, result }; return result;
  });
  const store = { bots, bot: (id: string) => bots.find((item) => item.id === id), messagesFor: () => messages,
    appendMessage: (_thread: string, input: { card: OptionCardData }) => { const message = { id: `message-${messages.length}`, card: input.card }; messages.push(message); return message; },
    patchMessage: (_thread: string, id: string, patch: { card: OptionCardData }) => { const message = messages.find((item) => item.id === id); if (!message) return null; Object.assign(message, patch); return message; },
    applyTeamSetup: apply,
  };
  let sourceExists = true;
  const deleteBot = vi.fn(async (id: string, revalidate: () => void, request?: TeamSetupRequest) => {
    revalidate();
    const target = bots.find((item) => item.id === id)!;
    if (request) chief.lastTeamSetupReceipt = { requestId: request.requestId, result: { state: "applied", bots: [{ id, name: target.name, action: "deleted" }] } };
    bots.splice(bots.indexOf(target), 1);
  });
  // null: a Cloud turn its owner did not drive, the one place the owner still confirms team setup on a card.
  const autoApply = vi.fn((): DirectApply | null => null);
  const targetBusy = vi.fn((id: string, _sourceThreadId?: string) => Boolean(store.bot(id)?.busy));
  const canPersist = vi.fn((): { ok: true } | { ok: false; status: number; error: string } => ({ ok: true }));
  const service = new TeamSetupRequestService({ store, maxBots: 100,
    canPersist, ownsThread: () => sourceExists, targetBusy, deleteBot, autoApply,
    validateModel: (selection, current) => {
      if (!({ claude: ["sonnet", "opus"], codex: ["gpt-fixture"] }[selection.instanceId]?.includes(selection.model))) return "Model is not in the current catalog";
      return current?.approvalMode === "full" && selection.instanceId !== current.modelSelection.instanceId ? "Existing permissions are incompatible" : null;
    },
    ...(caps ? { driverCapabilities: (instanceId: string) => caps[instanceId] } : {}),
  });
  const propose = (operations: unknown[]) => service.propose({ botId: chief.id, threadId: chief.threadId, plan: { reason: "Requested specialist setup", operations } });
  const submit = (operations: unknown[]) => service.submit({ botId: chief.id, threadId: chief.threadId, plan: { reason: "Requested specialist setup", operations } });
  const resolve = (requestId: string, behavior = "allow") => service.resolve({ botId: chief.id, threadId: chief.threadId, requestId, behavior });
  return { service, store, chief, peer, bot, propose, submit, resolve, apply, deleteBot, messages, autoApply, targetBusy, canPersist, removeSource: () => { sourceExists = false; } };
}
const specialist = (key: string, modelSelection = { instanceId: "claude", model: "sonnet" }) => ({ action: "create", key,
  fields: { name: key, title: "Specialist", soul: "Finish the assigned work.", modelSelection } });
const handover = (h: ReturnType<typeof harness>) => [
  { action: "update", botId: h.peer.id, fields: { chiefOfStaff: true } },
  { action: "update", botId: h.chief.id, fields: { chiefOfStaff: false } },
];

describe("reviewed Chief team setup", () => {
  it("reviews a Chief handover without changing anything on denial", async () => {
    const h = harness();
    const before = structuredClone(h.store.bots);
    const request = h.propose(handover(h));
    expect(request.detail).toContain("Chief of Staff: No → Yes. May coordinate and configure the other bots.");
    expect(request.detail).toMatch(/^Chief of Staff: Yes → No\.$/m);
    expect(h.store.bots).toEqual(before);
    expect((await h.resolve(request.requestId, "deny"))?.result.state).toBe("denied");
    expect(h.store.bots).toEqual(before);
  });
  it("warns what an engine switch gains and loses beyond the label", () => {
    const h = harness({
      claude: { driverKind: "claudeAgent", agentsMcp: true },
      codex: { driverKind: "codex", agentsMcp: false },
    });
    const card = h.propose([{ action: "update", botId: h.peer.id, fields: { modelSelection: { instanceId: "codex", model: "gpt-fixture" } } }]);
    expect(card.detail).toContain("Default AI and model");
    expect(card.detail).toContain("Loses peer coordination and every team tool");
    expect(card.detail).toContain("coordinate_bots");
    expect(card.detail).toContain("Loses approval levels: edits.");
    expect(card.detail).toContain("Gains approval levels: custom.");
  });
  it("renders nothing extra for a model-only change on the same engine", () => {
    const h = harness({ claude: { driverKind: "claudeAgent", agentsMcp: true } });
    const card = h.propose([{ action: "update", botId: h.peer.id, fields: { modelSelection: { instanceId: "claude", model: "opus" } } }]);
    expect(card.detail).toContain("Default AI and model");
    expect(card.detail).not.toContain("peer coordination");
    expect(card.detail).not.toContain("approval levels");
  });
  it("keeps one Chief and permits explicit replacement regardless of operation order", async () => {
    const h = harness();
    const next = specialist("Mira");
    expect(() => h.propose([{ ...next, fields: { ...next.fields, chiefOfStaff: true } }]))
      .toThrow("There can be only one Chief. Include the current Chief's demotion in this plan.");
    expect(() => h.propose([{ action: "update", botId: h.peer.id, fields: { chiefOfStaff: true } }])).toThrow(/one Chief/);
    const replace = h.propose(handover(h));
    expect((await h.resolve(replace.requestId))?.result.state).toBe("applied");
    expect(h.chief.chiefOfStaff).toBe(false);
    expect(h.peer.chiefOfStaff).toBe(true);
    expect((await h.resolve(replace.requestId))?.duplicate).toBe(true);
  });
  it.each(["conflict", "busy", "peer", "revision"])("cancels a handover after a %s change without partial mutation", async change => {
    const h = harness();
    const card = h.propose(handover(h));
    if (change === "conflict") h.bot("New Chief", { chiefOfStaff: true });
    if (change === "busy") h.peer.busy = true;
    if (change === "peer") h.chief.peers = [];
    if (change === "revision") h.peer.chiefOfStaff = true;
    const before = structuredClone(h.store.bots);
    expect((await h.resolve(card.requestId))?.result.state).toBe("cancelled");
    expect(h.store.bots).toEqual(before);
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("rejects malformed leadership and promotion outside peer scope", () => {
    const h = harness();
    expect(() => h.propose([{ action: "update", botId: h.peer.id, fields: { chiefOfStaff: "true" } }])).toThrow();
    h.chief.peers = [];
    expect(() => h.propose(handover(h))).toThrow("A target bot is outside the bots this Chief may reach");
    h.chief.chiefOfStaff = false;
    expect(() => h.propose([{ action: "update", botId: h.chief.id, fields: { chiefOfStaff: true } }])).toThrow(/Only an active Chief/);
    expect(h.messages).toHaveLength(0);
  });
  it("shows what stays owner-owned after creation on create cards, and keeps update cards lean", () => {
    const h = harness();
    const create = h.propose([specialist("Mira")]);
    expect(create.detail).toContain("New bots stay owner-owned after creation: the same connected apps as @Clive, the workspace's default access level, a private workspace by default, avatar untouched.");
    expect(create.detail).toContain("Existing execution permissions are unchanged.");
    const update = h.propose([{ action: "update", botId: h.peer.id, fields: { title: "Research lead" } }]);
    expect(update.detail).not.toContain("owner-owned");
    expect(update.detail).toContain("Existing execution permissions are unchanged.");
  });
  it("accepts a working folder on create only, with the profile path's exact validation copy", () => {
    const h = harness();
    const mira = specialist("Mira");
    const folder = mkdtempSync(join(tmpdir(), "omb-team-cwd-"));
    const withFolder = h.propose([{ ...mira, fields: { ...mira.fields, cwd: folder } }]);
    expect(withFolder.detail).toContain(`Working folder: "${folder}"`);
    expect(() => h.propose([{ ...mira, fields: { ...mira.fields, cwd: "relative/path" } }]))
      .toThrow("working folder must be an absolute path");
    expect(() => h.propose([{ ...mira, fields: { ...mira.fields, cwd: join(folder, "missing") } }]))
      .toThrow(`that folder doesn't exist: ${join(folder, "missing")}`);
    expect(() => h.propose([{ action: "update", botId: h.peer.id, fields: { cwd: folder } }]))
      .toThrow("A working folder can only be chosen when creating a bot; propose_profile changes it later");
  });
  it("carries a model variant through the plan instead of dropping it", () => {
    const h = harness();
    const card = h.propose([{ action: "update", botId: h.peer.id, fields: { modelSelection: { instanceId: "claude", model: "sonnet", variant: "stable" } } }]);
    expect(card.detail).toContain("Default AI and model:");
    expect(card.detail).toContain("claude/sonnet (no variant) → claude/sonnet (variant stable)");
  });
  it("coalesces each bot's fields into one review and applies once with a durable receipt", async () => {
    const h = harness();
    const request = h.propose([
      { action: "update", botId: h.peer.id, fields: { title: "Research lead" } },
      { action: "update", botId: h.peer.id, fields: { soul: "Verify sources.", modelSelection: { instanceId: "codex", model: "gpt-fixture" } } },
    ]);
    expect(h.messages).toHaveLength(1);
    expect(request.title).toBe("Apply setup for 1 bot?");
    expect(h.messages[0].card?.teamSetupRequest?.operations).toHaveLength(1);
    expect(request.detail).toContain("Every existing thread keeps its current model and permissions");
    expect(h.peer.title).toBe("");
    expect((await h.resolve(request.requestId))?.result.state).toBe("applied");
    expect(h.peer).toMatchObject({ title: "Research lead", soul: "Verify sources.", modelSelection: { instanceId: "codex", model: "gpt-fixture" } });
    expect((await h.resolve(request.requestId))?.duplicate).toBe(true);
    expect(h.apply).toHaveBeenCalledTimes(1);
  });
  it("reviews several specialists with multiple providers in one card", async () => {
    const h = harness();
    const request = h.propose([specialist("Mira"), specialist("Patch", { instanceId: "codex", model: "gpt-fixture" }), specialist("Quill")]);
    expect(request.title).toBe("Apply setup for 3 bots?");
    expect(h.store.bots).toHaveLength(2);
    expect((await h.resolve(request.requestId))?.result.bots).toHaveLength(3);
  });
  it("denial leaves all bots unchanged and closes the card", async () => {
    const h = harness(); const before = structuredClone(h.store.bots);
    const request = h.propose([specialist("Mira")]);
    expect((await h.resolve(request.requestId, "deny"))?.result.state).toBe("denied");
    expect(h.store.bots).toEqual(before); expect(h.apply).not.toHaveBeenCalled();
    expect((await h.resolve(request.requestId))?.result.state).toBe("denied");
  });
  it.each(["approvalMode", "autoApprove", "section", "peers", "composio", "cwd"])("rejects injected %s with no card", (field) => {
    const h = harness();
    expect(() => h.propose([{ action: "update", botId: h.peer.id, fields: { [field]: true } }])).toThrow();
    expect(h.messages).toHaveLength(0);
  });
  it("rejects unknown models and duplicate names across the whole team", () => {
    const h = harness();
    expect(() => h.propose([specialist("Mira", { instanceId: "codex", model: "made-up" })])).toThrow(/catalog/);
    expect(() => h.propose([specialist("Ada")])).toThrow("@Ada already exists");
    expect(() => h.propose([specialist("ada")])).toThrow("@ada already exists");
    expect(() => h.propose([specialist("Mira"), { action: "update", botId: h.peer.id, fields: { name: "Mira" } }])).toThrow(/already exists/);
    expect(h.apply).not.toHaveBeenCalled();
  });
  it.each(["target", "chief", "busy", "source"])("cancels a %s change while the review was open, without any batch mutation", async (change) => {
    const h = harness();
    const request = h.propose([{ action: "update", botId: h.peer.id, fields: { title: "Researcher" } }, specialist("Mira")]);
    if (change === "target") h.peer.title = "newer user edit";
    if (change === "chief") h.chief.chiefOfStaff = false;
    if (change === "busy") h.peer.busy = true;
    if (change === "source") h.removeSource();
    const before = structuredClone(h.store.bots);
    expect((await h.resolve(request.requestId))?.result.state).toBe("cancelled");
    expect(h.store.bots).toEqual(before); expect(h.apply).not.toHaveBeenCalled();
    expect(h.messages[0].card?.expired).toBe(true);
    expect(h.messages[0].card?.options).toEqual([]);
    expect(h.messages[0].card?.answered).toBeUndefined();
    expect(h.messages[0].card?.held).toBeTruthy();
  });
  it("applies a one-field plan despite unrelated drift on the target and the Chief", async () => {
    const h = harness();
    const card = h.propose([{ action: "update", botId: h.peer.id, fields: { modelSelection: { instanceId: "codex", model: "gpt-fixture" } } }]);
    h.peer.soul = "newer user edit";
    h.peer.description = "also newer";
    h.chief.title = "Renamed meanwhile";
    expect((await h.resolve(card.requestId))?.result.state).toBe("applied");
    expect(h.peer.modelSelection).toEqual({ instanceId: "codex", model: "gpt-fixture" });
    expect(h.peer.soul).toBe("newer user edit");
    expect(h.chief.title).toBe("Renamed meanwhile");
  });
  it("still cancels when a field the plan touches drifts, on the target and on the Chief", async () => {
    const h = harness();
    const target = h.propose([{ action: "update", botId: h.peer.id, fields: { modelSelection: { instanceId: "codex", model: "gpt-fixture" } } }]);
    h.peer.modelSelection = { instanceId: "claude", model: "opus" };
    expect((await h.resolve(target.requestId))?.result).toMatchObject({ state: "cancelled", error: "@Ada changed. This setup was cancelled; review a new proposal." });
    const chief = h.propose([{ action: "update", botId: h.chief.id, fields: { title: "Chief of Staff" } }]);
    h.chief.title = "Owner renamed the Chief";
    expect((await h.resolve(chief.requestId))?.result).toMatchObject({ state: "cancelled", error: "The Chief's settings changed. This setup was cancelled; review a new proposal." });
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("keeps a plan that never touches the Chief valid across the Chief's own drift", async () => {
    const h = harness();
    const card = h.propose([{ action: "update", botId: h.peer.id, fields: { title: "Researcher" } }]);
    h.chief.soul = "Chief drifted elsewhere";
    h.chief.modelSelection = { instanceId: "codex", model: "gpt-fixture" };
    expect((await h.resolve(card.requestId))?.result.state).toBe("applied");
    expect(h.peer.title).toBe("Researcher");
  });
  it("preserves existing elevated permissions and peer allowlists", () => {
    const h = harness(); h.peer.approvalMode = "full";
    expect(() => h.propose([{ action: "update", botId: h.peer.id, fields: { modelSelection: { instanceId: "codex", model: "gpt-fixture" } } }])).toThrow(/incompatible/);
    h.chief.peers = [];
    expect(() => h.propose([{ action: "update", botId: h.peer.id, fields: { title: "X" } }])).toThrow(/may reach/);
  });
  it("routes separately confirmed deletion through lifecycle guards once and never permits self-deletion", async () => {
    const h = harness();
    expect(() => h.service.proposeDeletion({ botId: h.chief.id, threadId: h.chief.threadId, targetBotId: h.chief.id, reason: "remove" })).toThrow(/may reach/);
    const request = h.service.proposeDeletion({ botId: h.chief.id, threadId: h.chief.threadId, targetBotId: h.peer.id, reason: "User asked to remove Ada" });
    expect(request.detail).toContain("Permanently removes this bot");
    expect(h.deleteBot).not.toHaveBeenCalled();
    expect((await h.resolve(request.requestId))?.result.bots).toEqual([{ id: h.peer.id, name: "Ada", action: "deleted" }]);
    await h.resolve(request.requestId); expect(h.deleteBot).toHaveBeenCalledTimes(1);
  });
  it("reports storage failure without claiming application", async () => {
    const h = harness(); h.apply.mockImplementation(() => { throw new Error("fixture disk full"); });
    const request = h.propose([specialist("Mira")]);
    expect((await h.resolve(request.requestId))?.result).toMatchObject({ state: "failed", bots: [], error: "fixture disk full" });
    expect(h.store.bots).toHaveLength(2);
  });
  it("does not apply or resurrect a review closed by Stop", async () => {
    const h = harness(); const card = h.propose([specialist("Mira")]);
    Object.assign(h.messages[0].card!, { answered: "unavailable", dismissed: true });
    expect(await h.resolve(card.requestId)).toMatchObject({ result: { state: "cancelled" }, duplicate: true });
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("renders a soul-only update as a SOUL.md line diff, not a JSON blob", () => {
    const h = harness(); h.peer.soul = "Verify sources.\nCheck citations.";
    const card = h.propose([{ action: "update", botId: h.peer.id, fields: { soul: "Verify sources.\nCheck citations and dates." } }]);
    expect(card.detail).toContain("SOUL.md (");
    expect(card.detail).toContain(" Verify sources.");
    expect(card.detail).toContain("-Check citations.");
    expect(card.detail).toContain("+Check citations and dates.");
    expect(card.detail).not.toContain('"soul":');
  });
  it("labels team-setup field changes with before and after like the profile card", () => {
    const h = harness(); h.peer.title = "Researcher";
    const card = h.propose([{ action: "update", botId: h.peer.id, fields: {
      title: "Research lead", modelSelection: { instanceId: "codex", model: "gpt-fixture" },
    } }]);
    expect(card.detail).toContain('Title: "Researcher" → "Research lead"');
    expect(card.detail).toContain("Default AI and model: claude/sonnet (no variant) → codex/gpt-fixture (no variant)");
  });
  it("shows the model variant on the current selection and its absence on the proposed one", () => {
    const h = harness();
    h.peer.modelSelection = { instanceId: "claude", model: "sonnet", variant: "high" };
    const card = h.propose([{ action: "update", botId: h.peer.id, fields: {
      modelSelection: { instanceId: "codex", model: "gpt-fixture" },
    } }]);
    expect(card.detail).toContain("Default AI and model: claude/sonnet (variant high) → codex/gpt-fixture (no variant)");
  });
});

describe("team setup that applies on its own", () => {
  it("applies a Chief handover under Full Access with an explicit receipt", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    const response = await h.submit(handover(h));
    expect(response).toMatchObject({ applied: true, state: "applied" });
    expect(response.detail).toContain("Chief of Staff: No → Yes");
    expect(h.peer.chiefOfStaff).toBe(true);
    expect(h.chief.chiefOfStaff).toBe(false);
  });
  it("creates and updates immediately with one settled receipt and an explicit result", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    const append = vi.spyOn(h.store, "appendMessage");
    const response = await h.submit([specialist("Mira"), { action: "update", botId: h.peer.id, fields: { title: "Research lead" } }]);
    expect(response).toMatchObject({ applied: true, state: "applied", result: { state: "applied", bots: [
      { name: "Mira", action: "created" }, { name: "Ada", action: "updated" },
    ] } });
    expect(h.autoApply).toHaveBeenCalledWith(h.chief.id, h.chief.threadId);
    expect(h.peer.title).toBe("Research lead");
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(h.messages).toHaveLength(1);
    // Applied on its own: nobody's answer, so the Chief's conversation stays the owner's alone.
    expect(append.mock.calls[0][1].card).toMatchObject({ answered: "allow", autoApplied: true, options: [], teamSetupRequest: { resumed: true, result: { state: "applied" } } });
    expect(h.messages.some(({ card }) => card && !card.answered && !card.dismissed)).toBe(false);
    expect(await h.resolve(response.requestId)).toMatchObject({ duplicate: true, result: { state: "applied" } });
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("waits on the owner's card when the turn is not the owner's, and applies only after their answer", async () => {
    const h = harness(); h.chief.approvalMode = "full";
    const response = await h.submit([specialist("Mira")]);
    expect(response).toMatchObject({ applied: false, state: "pending" });
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.messages[0].card?.answered).toBeUndefined();
    expect(h.messages[0].card?.options).toEqual(["Apply setup", "Cancel"]);
    expect(await h.resolve(response.requestId)).toMatchObject({ duplicate: false, result: { state: "applied" } });
    expect(await h.resolve(response.requestId)).toMatchObject({ duplicate: true, result: { state: "applied" } });
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("deletes through the same guarded lifecycle without publishing a pending confirmation", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    const response = await h.service.submitDeletion({ botId: h.chief.id, threadId: h.chief.threadId, targetBotId: h.peer.id, reason: "User requested deletion" });
    expect(response).toMatchObject({ state: "applied", applied: true, result: { bots: [{ id: h.peer.id, name: "Ada", action: "deleted" }] } });
    expect(h.store.bot(h.peer.id)).toBeUndefined();
    expect(h.messages[0].card).toMatchObject({ answered: "allow", options: [], teamSetupRequest: { resumed: true } });
    expect(await h.resolve(response.requestId)).toMatchObject({ duplicate: true, result: { state: "applied" } });
    expect(h.deleteBot).toHaveBeenCalledTimes(1);
  });

  it("does not apply setup or start deletion with an expired invocation", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    const canCommit = vi.fn(() => false);
    const source = { botId: h.chief.id, threadId: h.chief.threadId, canCommit };
    expect(await h.service.submit({ ...source, plan: { reason: "Requested setup", operations: [specialist("Mira")] } }))
      .toMatchObject({ state: "cancelled", applied: false, result: { error: expect.stringContaining("turn has expired") } });
    expect(await h.service.submitDeletion({ ...source, targetBotId: h.peer.id, reason: "remove" }))
      .toMatchObject({ state: "cancelled", applied: false, result: { error: expect.stringContaining("turn has expired") } });
    expect(h.apply).not.toHaveBeenCalled(); expect(h.deleteBot).not.toHaveBeenCalled();
    expect(h.store.bots).toHaveLength(2);
    expect(h.messages.every(({ card }) => card?.expired === true && card.options.length === 0)).toBe(true);
    expect(h.messages.every(({ card }) => !("canCommit" in card!.teamSetupRequest!))).toBe(true);
  });

  it.each(["stopped", "replaced"])("cancels deletion when its invocation is %s during lifecycle checks", async (change) => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    let generation: string | undefined = "original";
    let resume!: () => void;
    const inventory = new Promise<void>((resolve) => { resume = resolve; });
    const remove = h.deleteBot.getMockImplementation()!;
    h.deleteBot.mockImplementation(async (...parameters) => {
      parameters[1]();
      await inventory;
      await remove(...parameters);
    });
    const pending = h.service.submitDeletion({ botId: h.chief.id, threadId: h.chief.threadId,
      targetBotId: h.peer.id, reason: "remove", canCommit: () => generation === "original" });
    expect(h.deleteBot).toHaveBeenCalledTimes(1);
    expect(h.store.bot(h.peer.id)).toBe(h.peer);
    generation = change === "stopped" ? undefined : "replacement";
    resume();
    const response = await pending;
    expect(response).toMatchObject({ state: "cancelled", applied: false, result: { error: expect.stringContaining("turn has expired") } });
    expect(h.store.bot(h.peer.id)).toBe(h.peer);
    expect(h.chief.lastTeamSetupReceipt).toBeUndefined();
    expect(await h.resolve(response.requestId)).toMatchObject({ duplicate: true, result: { state: "cancelled" } });
    expect(h.deleteBot).toHaveBeenCalledTimes(1);
  });

  it("preserves saved deletion when its invocation expires during post-commit cleanup", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    let active = true;
    let resume!: () => void;
    const cleanup = new Promise<void>((resolve) => { resume = resolve; });
    const remove = h.deleteBot.getMockImplementation()!;
    h.deleteBot.mockImplementation(async (...parameters) => {
      await remove(...parameters);
      await cleanup;
      parameters[1]();
    });
    const pending = h.service.submitDeletion({ botId: h.chief.id, threadId: h.chief.threadId,
      targetBotId: h.peer.id, reason: "remove", canCommit: () => active });
    expect(h.store.bot(h.peer.id)).toBeUndefined();
    active = false;
    resume();
    const response = await pending;
    expect(response).toMatchObject({ state: "applied", applied: true, result: {
      bots: [{ id: h.peer.id, action: "deleted" }], error: expect.stringContaining("changes were saved"),
    } });
    expect(await h.resolve(response.requestId)).toMatchObject({ duplicate: true, result: { state: "applied" } });
    expect(h.deleteBot).toHaveBeenCalledTimes(1);
  });

  it("does not retain the invocation lease on the owner's card", async () => {
    const h = harness(); let active = true;
    const response = await h.service.submitDeletion({ botId: h.chief.id, threadId: h.chief.threadId,
      targetBotId: h.peer.id, reason: "remove", canCommit: () => active });
    expect(response.state).toBe("pending");
    expect(h.messages[0].card?.teamSetupRequest).not.toHaveProperty("canCommit");
    active = false;
    expect(await h.resolve(response.requestId)).toMatchObject({ result: { state: "applied" } });
    expect(h.deleteBot).toHaveBeenCalledTimes(1);
  });

  it("exempts only the requesting self-update turn, not siblings or other bots", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access"); h.chief.busy = true;
    h.targetBusy.mockImplementation((id, sourceThreadId) => Boolean(h.store.bot(id)?.busy) && sourceThreadId !== h.chief.threadId);
    expect(await h.submit([{ action: "update", botId: h.chief.id, fields: { title: "Updated Chief" } }])).toMatchObject({ state: "applied" });
    expect(h.targetBusy).toHaveBeenCalledWith(h.chief.id, h.chief.threadId);
    h.targetBusy.mockReturnValue(true);
    expect(await h.submit([{ action: "update", botId: h.chief.id, fields: { title: "Must not apply" } }])).toMatchObject({ state: "cancelled", applied: false });
    expect(h.chief.title).toBe("Updated Chief");
    h.peer.busy = true;
    await expect(h.submit([{ action: "update", botId: h.peer.id, fields: { title: "Must not apply" } }])).rejects.toThrow(/Stop @Ada/);
    expect(h.targetBusy).toHaveBeenCalledWith(h.peer.id, undefined);
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("retains model, scope, source, permission-field and deletion safety checks", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    h.chief.peers = [h.peer.id];
    await expect(h.submit([{ action: "update", botId: h.bot("Other").id, fields: { title: "X" } }])).rejects.toThrow(/may reach/);
    await expect(h.submit([specialist("Mira", { instanceId: "claude", model: "unknown" })])).rejects.toThrow(/catalog/);
    await expect(h.submit([{ action: "update", botId: h.peer.id, fields: { approvalMode: "full" } }])).rejects.toThrow();
    await expect(h.service.submitDeletion({ botId: h.chief.id, threadId: h.chief.threadId, targetBotId: h.chief.id, reason: "remove" })).rejects.toThrow(/may reach/);
    h.peer.busy = true;
    await expect(h.service.submitDeletion({ botId: h.chief.id, threadId: h.chief.threadId, targetBotId: h.peer.id, reason: "remove" })).rejects.toThrow(/working/);
    h.removeSource();
    await expect(h.submit([specialist("Mira")])).rejects.toThrow(/conversation/);
    expect(h.messages).toHaveLength(0); expect(h.apply).not.toHaveBeenCalled(); expect(h.deleteBot).not.toHaveBeenCalled();
  });

  it("rechecks the grant before mutation", async () => {
    const h = harness();
    h.autoApply.mockReturnValueOnce("level").mockReturnValue(null);
    expect(await h.submit([specialist("Mira")])).toMatchObject({ state: "cancelled", applied: false, result: { error: expect.stringContaining("on its own") } });
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("returns failure without an approval card or success claim when storage fails", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    h.apply.mockImplementation(() => { throw new Error("fixture disk full"); });
    const response = await h.submit([specialist("Mira")]);
    expect(response).toMatchObject({ state: "failed", applied: false, result: { state: "failed", bots: [], error: "fixture disk full" } });
    expect(h.store.bots).toHaveLength(2);
    expect(h.messages[0].card).toMatchObject({ expired: true, options: [], teamSetupRequest: { resumed: true } });
    expect(await h.resolve(response.requestId)).toMatchObject({ duplicate: true, result: { state: "failed" } });
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an unapplied deletion failure from saved deletion with cleanup failure", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    const args = { botId: h.chief.id, threadId: h.chief.threadId, targetBotId: h.peer.id, reason: "remove" };
    const remove = h.deleteBot.getMockImplementation()!;
    h.deleteBot.mockImplementation(async () => { throw new Error("fixture write failed"); });
    expect(await h.service.submitDeletion(args)).toMatchObject({ state: "failed", applied: false });
    expect(h.store.bot(h.peer.id)).toBe(h.peer);
    h.deleteBot.mockImplementation(async (...parameters) => { await remove(...parameters); throw new Error("fixture cleanup failed"); });
    expect(await h.service.submitDeletion(args)).toMatchObject({ state: "applied", applied: true, result: { error: expect.stringContaining("cleanup needs attention") } });
    expect(h.store.bot(h.peer.id)).toBeUndefined();
  });

  it("preserves an applied result when only writing its settled chat receipt fails", async () => {
    const h = harness(); h.autoApply.mockReturnValue("full-access");
    vi.spyOn(h.store, "appendMessage").mockImplementation(() => { throw new Error("fixture transcript write failed"); });
    expect(await h.submit([specialist("Mira")])).toMatchObject({ state: "applied", applied: true, result: { error: expect.stringContaining("could not be added") } });
    expect(h.chief.lastTeamSetupReceipt?.result.state).toBe("applied");
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(h.messages).toHaveLength(0);
  });
});

describe("team setup below Full access", () => {
  const undo = (h: ReturnType<typeof harness>, requestId: string) => h.service.undo({ botId: h.chief.id, threadId: h.chief.threadId, requestId });

  it("applies at Ask with no card, and Undo deletes the unused bot it created, once", async () => {
    const h = harness(); h.autoApply.mockReturnValue("level");
    const response = await h.submit([specialist("Mira")]);
    expect(response).toMatchObject({ state: "applied", applied: true, appliedBy: "level" });
    const created = h.store.bots.find((bot) => bot.name === "Mira")!;
    expect(h.messages[0].card).toMatchObject({ answered: "allow", autoApplied: true, options: [], teamSetupRequest: { undo: { created: [created.id] } } });
    expect(await undo(h, response.requestId)).toEqual({ claimed: true, state: "undone" });
    expect(h.deleteBot).toHaveBeenCalledWith(created.id, expect.any(Function));
    expect(h.store.bot(created.id)).toBeUndefined();
    expect(h.messages[0].card?.undone).toBe(true);
    expect(await undo(h, response.requestId)).toEqual({ claimed: true, state: "already_undone" });
  });

  it("gives updated bots back what the card showed", async () => {
    const h = harness(); h.autoApply.mockReturnValue("level"); h.peer.title = "Analyst";
    const response = await h.submit([specialist("Mira"), { action: "update", botId: h.peer.id, fields: { title: "Research lead" } }]);
    expect(h.peer.title).toBe("Research lead");
    expect(await undo(h, response.requestId)).toMatchObject({ state: "undone" });
    expect(h.peer.title).toBe("Analyst");
    expect(h.store.bots.some((bot) => bot.name === "Mira")).toBe(false);
  });

  it("refuses Undo, changing nothing, once a bot it touched changed or the new bot was used", async () => {
    const h = harness(); h.autoApply.mockReturnValue("level");
    const updated = await h.submit([{ action: "update", botId: h.peer.id, fields: { title: "Research lead" } }]);
    h.peer.title = "Person's title";
    expect(await undo(h, updated.requestId)).toMatchObject({ state: "invalid", stale: true, error: "Changed since, so it can't be undone here." });
    expect(h.peer.title).toBe("Person's title");
    const created = await h.submit([specialist("Mira")]);
    h.messages.push({ id: "person-line", role: "user" });
    expect(await undo(h, created.requestId)).toMatchObject({ state: "invalid", stale: true });
    expect(h.deleteBot).not.toHaveBeenCalled();
  });

  it("deletes a teammate at Ask with no card and no Undo", async () => {
    const h = harness(); h.autoApply.mockReturnValue("level");
    const response = await h.service.submitDeletion({ botId: h.chief.id, threadId: h.chief.threadId, targetBotId: h.peer.id, reason: "User requested deletion" });
    expect(response).toMatchObject({ state: "applied", applied: true });
    expect(h.store.bot(h.peer.id)).toBeUndefined();
    expect(h.messages[0].card?.teamSetupRequest?.undo).toBeUndefined();
    expect(await undo(h, response.requestId)).toMatchObject({ state: "invalid", status: 409 });
  });
});

describe("MausBot's Chief-level team setup", () => {
  const plan = (operations: unknown[]) => ({ reason: "Requested specialist setup", operations });

  it("lets the person's MausBot add a specialist like a Chief, without making it the Chief", () => {
    const h = harness();
    const maus = h.bot("Maus", { defaultBot: {} });
    const request = h.service.propose({ botId: maus.id, threadId: maus.threadId, plan: plan([specialist("Scout")]) });
    expect(request.detail).toContain("Scout");
    expect(maus.chiefOfStaff).toBeUndefined();
    expect(h.chief.chiefOfStaff).toBe(true);
  });

  it("never lets MausBot change who the Chief is", () => {
    const h = harness();
    const maus = h.bot("Maus", { defaultBot: {} });
    for (const target of [maus.id, h.peer.id, h.chief.id]) {
      expect(() => h.service.propose({ botId: maus.id, threadId: maus.threadId,
        plan: plan([{ action: "update", botId: target, fields: { chiefOfStaff: target !== h.chief.id } }]) })).toThrow(/Only the Chief of Staff changes who the Chief is/);
    }
  });

  it("never lets a Chief delete MausBot", () => {
    const h = harness();
    const maus = h.bot("Maus", { defaultBot: {} });
    expect(() => h.service.proposeDeletion({ botId: h.chief.id, threadId: h.chief.threadId, targetBotId: maus.id, reason: "remove" }))
      .toThrow(/Maus can't be deleted or archived/);
  });
});
