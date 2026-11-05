import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NewBotDefaults } from "./new-bot-defaults.ts";
import type { BotRecord } from "./store.ts";

const FIXTURES = join(import.meta.dirname, "..", "shared", "package-fixtures");
const fixture = (name: string): any => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const skillText = (name: string, body = "Do it well.") => `---\nname: ${name}\ndescription: ${name} steps.\n---\n\n# ${name}\n\n${body}\n`;
let home: string;

async function installation() {
  home = mkdtempSync(join(tmpdir(), "omb-presets-"));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  const { Store } = await import("./store.ts");
  const { RoutineManager } = await import("./routines.ts");
  const skills = await import("./skills.ts");
  const workspace = await import("./workspace.ts");
  const presets = await import("./presets.ts");
  const importer = await import("./package-import.ts");
  const exporter = await import("./package-export.ts");
  const { parsePackageDocument } = await import("../shared/package-format.ts");
  const store = new Store(() => ({ instanceId: "claude", model: "default-model" }));
  const routines = new RoutineManager({
    file: join(home, "routines.json"),
    botState: (id) => (store.bot(id) && !store.bot(id)!.hidden ? "ready" : "missing"),
    goalState: (groupId, botId) => (store.group(groupId ?? "")?.memberIds.includes(botId) ? "ready" : "missing"),
    createTask: () => null,
    startTurn: async () => {},
  });
  const presetFile = join(home, "presets.json");
  const presetStore = presets.createPresetStore(presetFile);
  const mcp = { servers: {} as Record<string, unknown> };
  const deps = {
    store,
    routines,
    skills: { install: skills.installSkill },
    memory: { writeIndex: workspace.writeMemoryFile, writeTopic: workspace.writeMemoryTopic },
    mcp: { servers: () => mcp.servers, persist: (next: Record<string, unknown>) => { mcp.servers = next; } },
    images: { save: () => "/api/attachments/fixture.png" },
    defaultSelection: () => ({ instanceId: "claude", model: "default-model" }),
    presets: presetStore,
  };
  const applyDeps = { store, skills: deps.skills, memory: deps.memory };
  return { store, skills, workspace, presets, importer, exporter, parsePackageDocument, presetStore, presetFile, deps, applyDeps };
}

afterEach(async () => {
  const { closeMessageDb } = await import("./message-db.ts");
  closeMessageDb();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("preset store", () => {
  it("adds a team file's presets as file presets, once per identical file, and a failed import removes them again", async () => {
    const app = await installation();
    const document = app.parsePackageDocument(fixture("full-team.v2.json"));
    const first = app.importer.importPackageDocument(document, { mode: "add" }, app.deps);
    expect(first.presets).toEqual([{ id: expect.any(String), key: "support", name: "Support agent" }]);
    expect(first.skipped).toEqual([]);
    const [row] = app.presetStore.list();
    expect(row).toMatchObject({ installId: first.installId, packageId: "sales-desk", packageName: "Sales desk", release: "1.3.0", key: "support" });
    expect(row).not.toHaveProperty("publisher");
    const stored = JSON.parse(readFileSync(app.presetFile, "utf8"));
    expect(stored.content[first.installId!].skills.map((skill: { name: string }) => skill.name)).toEqual(["objection-handling"]);
    expect(stored.content[first.installId!].playbooks.map((playbook: { key: string }) => playbook.key)).toEqual(["qualify"]);

    const second = app.importer.importPackageDocument(document, { mode: "add" }, app.deps);
    expect(second.presets).toEqual(first.presets);
    expect(app.presetStore.list()).toHaveLength(1);

    const changed = fixture("full-team.v2.json");
    changed.package.presets[0].bot.soul = "Be brief.\n";
    app.importer.importPackageDocument(app.parsePackageDocument(changed), { mode: "add" }, app.deps);
    expect(app.presetStore.list()).toHaveLength(2);

    const another = fixture("full-team.v2.json");
    another.package.presets[0].name = "Support agent (new)";
    const bots = app.store.bots.length;
    const lateFailure = { ...app.deps, broadcast: () => { throw new Error("window gone"); } };
    expect(() => app.importer.importPackageDocument(app.parsePackageDocument(another), { mode: "add" }, lateFailure)).toThrow("window gone");
    expect(app.presetStore.list()).toHaveLength(2);
    expect(app.store.bots).toHaveLength(bots);
  });

  it("stores a library file's presets and offers its skills, and refuses a file with nothing to add", async () => {
    const app = await installation();
    const result = app.importer.importPackageDocument(app.parsePackageDocument(fixture("library-only.v2.json")), { mode: "add" }, app.deps);
    expect(result).toMatchObject({ name: "Sales skills", bots: [], groups: [], routines: [], offeredSkills: ["objection-handling", "follow-up"], connections: [], brief: false, notes: 0 });
    expect(result.presets).toEqual([{ id: expect.any(String), key: "support", name: "Support agent" }]);
    expect(app.store.bots).toEqual([]);

    const skillsOnly = fixture("library-only.v2.json");
    delete skillsOnly.package.presets;
    expect(() => app.importer.importPackageDocument(app.parsePackageDocument(skillsOnly), { mode: "add" }, app.deps))
      .toThrow(app.importer.NO_PRESETS_MESSAGE);
    expect(app.presetStore.list()).toHaveLength(1);
  });

  it("lists presets and never lists a tampered row", async () => {
    const app = await installation();
    app.importer.importPackageDocument(app.parsePackageDocument(fixture("library-only.v2.json")), { mode: "add" }, app.deps);
    const changed = fixture("library-only.v2.json");
    changed.package.presets[0].name = "Support lead";
    app.importer.importPackageDocument(app.parsePackageDocument(changed), { mode: "add" }, app.deps);
    const listed = app.presets.listBotPresets(app.presetStore);
    expect(listed.map((preset) => preset.name).sort()).toEqual(["Support agent", "Support lead"]);
    expect(listed.find((preset) => preset.name === "Support agent")).toMatchObject({ key: "support", packageName: "Sales skills", release: "2.0.1",
      bot: { name: "Sky", title: "Support", appearance: { color: "blue" } }, skills: [{ name: "objection-handling", description: "Answer common objections." }], playbooks: [], notes: [] });

    const stored = JSON.parse(readFileSync(app.presetFile, "utf8"));
    Object.assign(stored.presets[0].bot, { approvalMode: "full", modelSelection: { instanceId: "x", model: "y" }, cwd: "/", computer: "local" });
    stored.presets[1].seed = { memory: { "memory/log/2026-09-24.md": "chat" } };
    writeFileSync(app.presetFile, JSON.stringify(stored));
    const after = app.presets.listBotPresets(app.presetStore);
    expect(after).toHaveLength(1);
    expect(JSON.stringify(after)).not.toMatch(/approvalMode|modelSelection|cwd|computer/);
    expect(app.presetStore.resolve(stored.presets[1].id)).toBeNull();
  });

  it("reads a row an organization once added as an ordinary preset: no publisher, skills added off, removable", async () => {
    const app = await installation();
    app.importer.importPackageDocument(app.parsePackageDocument(fixture("library-only.v2.json")), { mode: "add" }, app.deps);
    const stored = JSON.parse(readFileSync(app.presetFile, "utf8"));
    stored.presets = [{ ...stored.presets[0], id: "org-preset-1", source: "org", publisherName: "Acme Partners",
      publisher: { organizationId: "org-acme", slug: "acme", name: "Acme Partners" }, ref: "acme/sales-skills", sha256: "a".repeat(64) }];
    writeFileSync(app.presetFile, JSON.stringify(stored));
    const listed = app.presets.listBotPresets(app.presetStore);
    expect(listed.map((preset) => preset.id)).toEqual(["org-preset-1"]);
    expect(JSON.stringify(listed)).not.toMatch(/Acme|"source"|"publisher/);
    const bot = app.store.createBot({ name: "Sky", modelSelection: { instanceId: "claude", model: "default-model" } });
    app.presets.applyPresetToBot(bot.id, app.presetStore.resolve("org-preset-1")!, app.applyDeps);
    expect(app.skills.listSkills(bot.id)).toEqual([expect.objectContaining({ name: "objection-handling", enabled: false })]);
    expect(app.store.bot(bot.id)!.installedPackage).toEqual({ id: "sales-skills", name: "Sales skills", release: "2.0.1", requiredApps: [],
      installId: stored.presets[0].installId, presetKey: "support" });
    expect(app.presetStore.removeFilePreset("org-preset-1")).toBe("removed");
    expect(app.presetStore.removeFilePreset("missing")).toBe("not_found");
    expect(app.presetStore.list()).toEqual([]);
  });
});

describe("creating a bot from a preset", () => {
  it("adds a file preset's skills switched off, its playbooks and starter notes, and stamps where it came from", async () => {
    const app = await installation();
    const input = fixture("full-team.v2.json");
    input.package.presets[0].seed = { memory: { "MEMORY.md": "- Greets by name.\n", "memory/tone.md": "Warm.\n" } };
    const imported = app.importer.importPackageDocument(app.parsePackageDocument(input), { mode: "add" }, app.deps);
    const resolved = app.presetStore.resolve(imported.presets![0]!.id)!;
    const bot = app.store.createBot({ name: "Sky", modelSelection: { instanceId: "claude", model: "default-model" } });
    expect(app.presets.applyPresetToBot(bot.id, resolved, app.applyDeps)).toEqual({ skills: ["objection-handling"], notes: 2 });
    expect(app.skills.listSkills(bot.id)).toEqual([expect.objectContaining({ name: "objection-handling", enabled: false, source: "package:sales-desk" })]);
    expect(app.workspace.readMemoryFile(bot.id).text).toBe("- Greets by name.\n");
    expect(app.workspace.readMemoryTopic(bot.id, "tone.md")).toBe("Warm.\n");
    const record = app.store.bot(bot.id)!;
    expect(record.playbooks).toEqual([expect.objectContaining({ key: "qualify", name: "Qualify a lead" })]);
    expect(record.installedPackage).toEqual({ id: "sales-desk", name: "Sales desk", release: "1.3.0", requiredApps: [],
      installId: imported.installId, presetKey: "support" });
    expect(record.modelSelection).toEqual({ instanceId: "claude", model: "default-model" });
    for (const field of ["approvalMode", "autoApprove", "computer", "cwd", "composio", "mcpServers", "browser"] as const) {
      expect(record).not.toHaveProperty(field);
    }
  });
});

describe("sharing my New bot defaults as a preset", () => {
  const defaults = (overrides: Partial<NewBotDefaults> = {}): NewBotDefaults => ({
    profile: {
      name: "Sky", title: "Support", description: "Answers customers.", soul: "Be kind.\n", color: "blue", mascotExpression: "happy",
      modelSelection: { instanceId: "claude", model: "opus" }, computer: "local", cwd: "/Users/me/secret", approvalMode: "full",
      alwaysAllow: ["Bash(*)"], chiefOfStaff: true, peers: ["x"], composio: true, browser: true,
      browserProfile: "work", mcpServers: ["crm"], approvePeerComms: true, parkDirectMessages: true, avatarCrop: "rounded",
    },
    memory: { "MEMORY.md": "- Customers first.\n", "memory/tone.md": "Warm.\n" },
    skills: [{ name: "follow-up", description: "follow-up steps.", source: "https://github.com/acme/skills", text: skillText("follow-up"), enabled: true, warnings: [] }],
    routines: [{ name: "Daily", prompt: "Check the inbox.", schedule: { type: "daily", time: "09:00", weekdays: [1] } }],
    ...overrides,
  });

  it("keeps only the allowlist: name, look, instructions, skills and (when asked) starter notes", async () => {
    const app = await installation();
    const built = app.presets.presetFromDefaults(defaults(), { name: "Support agent", description: "Kind and precise.", includeNotes: true,
      avatar: { mime: "image/png", data: PNG } });
    expect(built.skipped).toEqual([]);
    expect(built.value!.preset).toEqual({
      key: "new-bot-defaults", name: "Support agent", description: "Kind and precise.",
      bot: { name: "Sky", title: "Support", description: "Answers customers.", soul: "Be kind.\n",
        appearance: { color: "blue", mascotExpression: "happy", avatar: { mime: "image/png", data: PNG, crop: "rounded" } } },
      skills: ["follow-up"],
      seed: { memory: { "MEMORY.md": "- Customers first.\n", "memory/tone.md": "Warm.\n" } },
    });
    expect(JSON.stringify(built.value)).not.toMatch(/opus|secret|full|Bash|crm|work|Daily/);
    expect(app.presets.presetFromDefaults(defaults(), { includeNotes: false }).value!.preset).not.toHaveProperty("seed");
    const empty = app.presets.presetFromDefaults({ profile: { approvalMode: "auto", computer: "local" }, memory: {}, skills: [], routines: [] }, { includeNotes: true });
    expect(empty).toEqual({ value: null, skipped: [{ part: "presets[new-bot-defaults]", reason: "preset_empty" }] });
  });

  it("goes into a team file with its skills, never pushing out the team's own", async () => {
    const app = await installation();
    const built = app.presets.presetFromDefaults(defaults({
      skills: [
        { name: "follow-up", description: "follow-up steps.", source: "fixture", text: skillText("follow-up"), enabled: true, warnings: [] },
        { name: "research-brief", description: "research-brief steps.", source: "fixture", text: skillText("research-brief", "Different."), enabled: true, warnings: [] },
      ],
    }), { includeNotes: true });
    const bot = { id: "b1", threadId: "t1", name: "Morgan", color: "green", createdAt: 1 } as BotRecord;
    const exported = app.exporter.createTeamPackageExport({
      name: "Sales desk", bots: [bot], groups: [], routines: [], published: null,
      skillsByBot: new Map([["b1", [{ name: "research-brief", description: "research-brief steps.", instructions: skillText("research-brief"), source: "fixture" }]]]),
      preset: built.value,
    });
    const pkg = exported.document.package;
    expect(pkg.presets).toEqual([expect.objectContaining({ key: "new-bot-defaults", name: "Sky", skills: ["follow-up"] })]);
    expect(pkg.skills!.entries.map((skill) => skill.name).sort()).toEqual(["follow-up", "research-brief"]);
    expect(pkg.skills!.entries.find((skill) => skill.name === "research-brief")!.instructions).toContain("Do it well.");
    expect(exported.skipped).toEqual([{ part: "presets[new-bot-defaults].skills[research-brief]", reason: "preset_skill_conflict" }]);
    expect(JSON.stringify(pkg)).not.toMatch(/enabled|opus|approval/);
  });

  it("saves a library file of the preset and its skills, redacted, with a stable id and the next release", async () => {
    const app = await installation();
    const built = app.presets.presetFromDefaults(defaults({ profile: { name: "Sky", soul: "Use password=Hunter2-Secret-99 for the portal.\n" } }), { name: "Support agent", includeNotes: true });
    const first = app.exporter.createLibraryPackageExport({ published: null, preset: built.value, authorName: "Mira" });
    expect(first.filename).toBe("support-agent-1.0.0.openmaus.json");
    expect(first.redacted).toEqual(["presets[new-bot-defaults].bot.soul"]);
    expect(JSON.stringify(first.document)).not.toContain("Hunter2-Secret-99");
    expect(first.document.package).toMatchObject({ id: "support-agent", agents: [], author: { name: "Mira" }, presets: [expect.objectContaining({ skills: ["follow-up"] })] });
    expect(first.document.package).not.toHaveProperty("team");
    expect(() => app.parsePackageDocument(first.document)).not.toThrow();
    const second = app.exporter.createLibraryPackageExport({ published: first.published, preset: built.value, name: "Renamed" });
    expect(second.document.package).toMatchObject({ id: "support-agent", release: "1.0.1", name: "Renamed" });
    expect(() => app.exporter.createLibraryPackageExport({ published: null, preset: null })).toThrow("Your New bot defaults are empty");
    expect(() => app.exporter.createLibraryPackageExport({ published: null, preset: built.value, release: "one" })).toThrow("Use a version like 1.2.3.");

    const imported = app.importer.importPackageDocument(app.parsePackageDocument(JSON.parse(JSON.stringify(first.document))), { mode: "add" }, app.deps);
    const bot = app.store.createBot({ name: "Sky", modelSelection: { instanceId: "claude", model: "default-model" } });
    app.presets.applyPresetToBot(bot.id, app.presetStore.resolve(imported.presets![0]!.id)!, app.applyDeps);
    expect(app.skills.listSkills(bot.id)).toEqual([expect.objectContaining({ name: "follow-up", enabled: false })]);
    expect(app.workspace.readMemoryTopic(bot.id, "tone.md")).toBe("Warm.\n");
  });

  it("records what was last shared and starts over from an unreadable record", async () => {
    const app = await installation();
    const file = join(home, "published-library.json");
    expect(app.presets.readPublishedLibrary(file)).toBeNull();
    app.presets.writePublishedLibrary({ packageId: "support-agent", lastRelease: "1.0.4" }, file);
    expect(app.presets.readPublishedLibrary(file)).toEqual({ packageId: "support-agent", lastRelease: "1.0.4" });
    writeFileSync(file, "{");
    expect(app.presets.readPublishedLibrary(file)).toBeNull();
  });
});
