import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { DATA_DIR, type AppConfig } from "../config.ts";
import * as probeModule from "../mcp-probe.ts";
import { McpOAuthManager } from "../mcp-oauth.ts";
import { listMcpServers, type StoredMcpServer } from "../mcp-registry.ts";
import { createMcpConfig } from "./mcp-config.ts";

const remote = (url = "https://data.example.com/mcp"): StoredMcpServer => ({ type: "http", url, headers: {}, enabled: false }) as StoredMcpServer;

function fixture() {
  const cfg: Pick<AppConfig, "mcpServers" | "postiz"> = { mcpServers: {} };
  const mcpOAuth = new McpOAuthManager({ file: join(DATA_DIR, "mcp-config-oauth.json") });
  const forget = vi.spyOn(mcpOAuth, "forget");
  const changed = vi.fn();
  let busy = false;
  const config = createMcpConfig({
    cfg,
    sessions: { isLive: () => true },
    mcpOAuth,
    fallbackPublicUrl: null,
    mcpConfigBusy: { get: () => busy, set: (value) => { busy = value; } },
    mcpServerResponse: () => ({ servers: listMcpServers(cfg.mcpServers) }),
    persistMcpServers: (next) => { cfg.mcpServers = next; },
    savedCustomDomain: () => null,
    changed,
  });
  return { cfg, config, changed, forget, setBusy: (value: boolean) => { busy = value; } };
}

describe("shared MCP config", () => {

  it("every successful add, replace, setEnabled and remove calls changed() once", async () => {
    const { config, changed } = fixture();
    const steps = [
      () => config.add("warehouse", remote()),
      () => config.replace("warehouse", remote("https://other.example.com/mcp")),
      () => config.setEnabled("warehouse", true),
      () => config.setApps("warehouse", false),
      () => config.addMany(async () => ({ servers: { nightwatch: remote("https://nightwatch.example.com/mcp") } })),
      () => config.remove("warehouse"),
    ];
    for (const [index, step] of steps.entries()) {
      changed.mockClear();
      expect((await step()).status, `step ${index}`).toBeLessThan(300);
      expect(changed, `step ${index}`).toHaveBeenCalledTimes(1);
    }
    changed.mockClear();
    expect(config.remove("warehouse").status).toBe(404);
    expect(changed).not.toHaveBeenCalled();
  });

  it("an import holds the flag while its body is read, so another writer is refused until it ends", async () => {
    const { config, cfg } = fixture();
    let finish!: () => void;
    const body = new Promise<void>((resolve) => { finish = resolve; });
    const importing = config.addMany(async () => { await body; return { servers: { nightwatch: remote("https://nightwatch.example.com/mcp") } }; });
    expect(config.add("warehouse", remote())).toEqual({ status: 409, error: "MCP servers are already being updated." });
    expect(await config.addMany(async () => ({ servers: {} }))).toEqual({ status: 409, error: "MCP servers are already being updated." });
    finish();
    expect((await importing).status).toBe(201);
    expect(Object.keys(cfg.mcpServers ?? {})).toEqual(["nightwatch"]);
    expect(config.add("warehouse", remote()).status).toBe(201);
  });

  it("an import that fails while reading its body lets the next writer in", async () => {
    const { config } = fixture();
    await expect(config.addMany(async () => { throw new Error("body too large"); })).rejects.toThrow("body too large");
    expect(config.add("warehouse", remote()).status).toBe(201);
  });

  it("tests as a bot when asked to, so a command server runs in that bot's folder", async () => {
    const { cfg, config } = fixture();
    cfg.mcpServers = { notes: { command: "definitely-not-a-real-program-xyz", args: [], env: {}, enabled: true } as never };
    const probe = vi.spyOn(probeModule, "probeMcpServer").mockResolvedValue({ ok: true, tools: [] });
    await config.test("notes", { signal: new AbortController().signal, asBot: { id: "bot-1", cwd: "/tmp/bot-1" } });
    expect(probe.mock.calls[0]?.[3]).toMatchObject({ asBot: { id: "bot-1", cwd: "/tmp/bot-1" } });
    probe.mockRestore();
  });

  it("says which server it could not find", async () => {
    const { config } = fixture();
    const missing = { status: 404, error: 'MCP server "mail" not found. It may have been removed: check Apps → MCP servers.' };
    expect(config.remove("mail")).toEqual(missing);
    await expect(config.test("mail", { signal: new AbortController().signal })).resolves.toEqual(missing);
  });

  it("a write while busy returns 409 \"MCP servers are already being updated.\"", () => {
    const { config, changed, setBusy } = fixture();
    setBusy(true);
    expect(config.add("warehouse", remote())).toEqual({ status: 409, error: "MCP servers are already being updated." });
    expect(changed).not.toHaveBeenCalled();
  });

  it("replace to a new url forgets the sign-in", () => {
    const { config, forget } = fixture();
    config.add("warehouse", remote());
    config.replace("warehouse", remote());
    expect(forget).not.toHaveBeenCalled();
    config.replace("warehouse", remote("https://elsewhere.example.com/mcp"));
    expect(forget).toHaveBeenCalledWith("warehouse");
  });
});

describe("how many MCP servers fit", () => {
  const own = (bot: string): StoredMcpServer => ({ command: "linear-mcp", args: [], env: {}, enabled: false, bot }) as StoredMcpServer;
  const fill = (cfg: { mcpServers?: Record<string, unknown> }, count: number, make: (i: number) => StoredMcpServer, prefix: string) => {
    const next = { ...cfg.mcpServers };
    for (let i = 0; i < count; i++) next[`${prefix}${i}`] = make(i);
    cfg.mcpServers = next as never;
  };

  it("lets each bot have its own servers up to 20 with the shared ones, while other bots can still add theirs", () => {
    const { cfg, config } = fixture();
    fill(cfg, 2, () => remote(), "shared");
    fill(cfg, 18, () => own("bot-a"), "a");
    expect(config.add("a18", own("bot-a"))).toEqual({ status: 400, error: "A bot can use at most 20 MCP servers: the shared ones plus its own." });
    expect(config.add("b0", own("bot-b"))).toMatchObject({ status: 201 });
    fill(cfg, 17, () => own("bot-b"), "b-more");
    expect(Object.keys(cfg.mcpServers ?? {})).toHaveLength(38);
    expect(config.add("c0", own("bot-c"))).toMatchObject({ status: 201 });
  });

  it("refuses a shared server that would take any bot past 20, and keeps the old words when no bot has its own", () => {
    const { cfg, config } = fixture();
    fill(cfg, 20, () => remote(), "s");
    expect(config.add("extra", remote())).toEqual({ status: 400, error: "You can add at most 20 MCP servers." });
    cfg.mcpServers = {};
    fill(cfg, 1, () => remote(), "s");
    fill(cfg, 19, () => own("bot-a"), "a");
    expect(config.add("extra", remote())).toEqual({ status: 400, error: "A bot can use at most 20 MCP servers: the shared ones plus its own." });
  });

  it("holds at most 100 servers in all", () => {
    const { cfg, config } = fixture();
    for (let bot = 0; bot < 5; bot++) fill(cfg, 20, () => own(`bot-${bot}`), `b${bot}-`);
    expect(config.add("one-more", own("bot-new"))).toEqual({ status: 400, error: "You can add at most 100 MCP servers in all." });
  });

  it("an import counts each pasted server against the same limits", async () => {
    const { cfg, config } = fixture();
    fill(cfg, 15, () => own("bot-a"), "a");
    const servers = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i}`, remote()]));
    expect(await config.addMany(async () => ({ servers }))).toEqual({ status: 400, error: "A bot can use at most 20 MCP servers: the shared ones plus its own." });
    const five = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i}`, remote()]));
    expect(await config.addMany(async () => ({ servers: five }))).toMatchObject({ status: 201 });
  });
});
