// Saved steps on a lent Mac and in the bot's browser, served by a Linux server (a Boat), end to end with fakes: an AI run
// through the turn's harness endpoints is journaled and saved, the same words replay it with no AI through those same
// endpoints, and a step that no longer fits is handed to the AI, whose run becomes the recipe's next revision.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestKey, type Recipe } from "agent-steps";
import type { ProviderInstance, RuntimeEvent, SendTurnInput, TurnStartResult } from "../contracts.ts";
import { harnessMcpTokenEnv } from "../harness-mcp-token.ts";
import type { Message } from "../store.ts";
import { completeWindowState, windowState } from "../testing/saved-steps-fixtures.ts";
import { openHarnessCaller } from "./computer-client.ts";
import { createSavedSteps, type SavedSteps } from "./saved-steps.ts";

const REQUEST = "Open TextEdit, type hello world and open Billing on example.com";
const OWNER = { origin: { kind: "user" }, personLine: true };
const SITE = "https://example.com/";

/** The lent Mac's TextEdit and its person's Chrome, as the computer's jobs would answer them. */
class LentComputer {
  snapshot = 1;
  page = 1;
  document = "";
  twoBillingLinks = false;
  acted: string[] = [];

  screen(name: string, args: Record<string, unknown>): Record<string, unknown> {
    const done = (structured: Record<string, unknown> = {}) => ({ content: [{ type: "text", text: "ok" }], structuredContent: structured });
    if (name === "list_apps") return done({ apps: [{ pid: 4242, name: "TextEdit", bundle_id: "com.apple.TextEdit", running: true }] });
    if (name === "list_windows") return done({ windows: [{ window_id: 7, pid: 4242, title: "Untitled", app_name: "TextEdit" }] });
    if (name === "get_window_state") return done(completeWindowState(windowState(this.snapshot++), this.document));
    this.acted.push(name);
    if (name === "set_value") this.document = String(args.value);
    return done();
  }

  browser(name: string): Record<string, unknown> {
    const text = (value: string) => ({ content: [{ type: "text", text: value }] });
    if (name === "agent_browser_snapshot") {
      const n = this.page++;
      const help = this.twoBillingLinks ? `\n- heading "Help" [level=2, ref=e${n}9]\n- link "Billing" [ref=e${n}8]` : "";
      return text(`- heading "Account" [level=1, ref=e${n}1]\n- link "Billing" [ref=e${n}2]\n- link "Profile" [ref=e${n}3]${help}`);
    }
    if (name === "agent_browser_get_url") return text(SITE);
    this.acted.push(name);
    return text("Done");
  }
}

describe("saved steps on a lent computer", () => {
  let dir: string;
  let server: Server;
  let url: string;
  let lent: LentComputer;
  let steps: SavedSteps;
  let generation: string;
  let events: RuntimeEvent[];
  let patches: Array<[string, Partial<Message>]>;
  const slots = new Map<string, ProviderInstance>();
  const engine = { instanceId: "claude", driverKind: "claudeAgent", adapter: { provider: "claudeAgent" } } as unknown as ProviderInstance;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "omb-saved-steps-lent-"));
    lent = new LentComputer();
    events = [];
    patches = [];
    generation = "g1";
    steps = createSavedSteps({
      enabled: () => true,
      bot: () => ({}),
      publish: (event) => {
        events.push(event);
        if (event.type === "request.opened") void slots.get(event.threadId)!.adapter.respondToRequest(event.threadId, event.requestId!, { behavior: "allow" });
      },
      engines: { get: (threadId) => slots.get(threadId), set: (threadId, instance) => { slots.set(threadId, instance); } },
      stopped: () => false,
      generation: () => generation,
      patchMessage: (_threadId, messageId, patch) => { patches.push([messageId, patch]); },
      withholdHandoff: () => () => {},
      contextChanged: () => {},
      folder: (botId) => join(dir, botId),
      platform: "linux",
    });
    // The turn's harness endpoints, as server/index.ts serves them for a lent computer: each call journaled for the turn.
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", async () => {
        const body = JSON.parse(raw) as { params: { name: string; arguments: Record<string, unknown> } };
        const browser = req.url === "/api/internal/browser/mcp";
        const capability = { botId: "b1", threadId: "t1", generation, kind: browser ? "browser" : "computer", ...(browser ? {} : { lentComputerId: "mini" }) };
        const result = await steps.journalCall(capability, OWNER, browser ? "agent-browser" : "cua", body, async () =>
          (browser ? lent.browser(body.params.name) : lent.screen(body.params.name, body.params.arguments)));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    slots.clear();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  let lentPlatform: "darwin" | "win32" = "darwin";
  const places = () => ({
    localComputer: { command: process.execPath, args: [], env: { OMB_HARNESS_URL: url, [harnessMcpTokenEnv("computer")]: "turn-token" }, platform: lentPlatform, scope: "lent-computer" as const },
    browser: { command: process.execPath, args: [], env: { OMB_HARNESS_URL: url, [harnessMcpTokenEnv("browser")]: "turn-token" } },
  });
  const line = (id: string): Message => ({ id, at: 1, role: "user", kind: "text", text: REQUEST });
  const send = async (id: string) => {
    slots.set("t1", engine);
    const start = vi.fn(async (_input: SendTurnInput): Promise<TurnStartResult> => ({ turnId: `ai-${id}` }));
    const input: SendTurnInput = { threadId: "t1", botId: "b1", text: REQUEST, approvalMode: "full", integrations: places() };
    const sent = await steps.dispatch.sendTurn(engine, { botId: "b1", message: line(id), turnText: REQUEST, placePicked: true }, input, start);
    return { start, turnId: sent.turnId };
  };
  const settle = (id: string, turnId: string) => {
    const reply: Message = { id: `reply-${id}`, at: 2, role: "bot", kind: "text", text: "Done.", turnId, requestMessageId: id, turnTerminal: true, turnSucceeded: true };
    steps.requestSettled({ botId: "b1", threadId: "t1", request: line(id), reply, after: [reply], generations: new Set([generation]), automated: false });
  };
  /** What the AI does: reads, then acts by the tokens and refs it just read. */
  const aiRun = async () => {
    const screen = openHarnessCaller(places().localComputer, "computer");
    const web = openHarnessCaller(places().browser, "browser");
    const signal = new AbortController().signal;
    await screen.call("list_apps", {}, signal);
    await screen.call("list_windows", { pid: 4242 }, signal);
    const state = await screen.call("get_window_state", { pid: 4242, window_id: 7 }, signal);
    const token = ((state.ok ? state.structured.elements : []) as Array<{ role: string; element_token: string }>).find((element) => element.role === "AXTextArea")!.element_token;
    await screen.call("click", { element_token: token }, signal);
    await screen.call("set_value", { element_token: token, value: "hello world" }, signal);
    await web.call("agent_browser_open", { url: SITE }, signal);
    await clickBilling();
  };
  const clickBilling = async () => {
    const web = openHarnessCaller(places().browser, "browser");
    const signal = new AbortController().signal;
    const page = await web.call("agent_browser_snapshot", {}, signal);
    const ref = /link "Billing" \[ref=(e\d+)\]/u.exec(page.ok ? page.text ?? "" : "")![1];
    await web.call("agent_browser_click", { selector: `@${ref}` }, signal);
  };
  const saved = (): Recipe | undefined => steps.recipes.find("b1", requestKey(REQUEST));

  it("learns from an AI run, repeats it with no AI, and repairs it when the page changed", async () => {
    // 1. No recipe yet: the AI does the task, and its run is saved.
    const first = await send("m1");
    expect(first.start).toHaveBeenCalledTimes(1);
    await aiRun();
    settle("m1", first.turnId);
    const learned = saved()!;
    expect(learned.revision).toBe(1);
    expect(learned.steps.map((step) => `${step.driver}:${step.tool}`)).toEqual(["cua:click", "cua:set_value", "agent-browser:open", "agent-browser:click"]);
    expect(learned.steps[3]).toEqual({ driver: "agent-browser", tool: "click", args: {}, target: { role: "link", name: "Billing", url: SITE } });
    expect(JSON.stringify(learned)).not.toMatch(/turn-token|"@e|s\d-e\d|4242/u);
    expect(patches.at(-1)).toEqual(["reply-m1", { savedSteps: { recipeId: learned.id, learned: true } }]);

    // 2. The same words: every step found again and done through the lent computer's endpoints, with no AI.
    generation = "g2";
    lent.acted = [];
    const second = await send("m2");
    await vi.waitFor(() => expect(events.some((event) => event.type === "turn.completed" && event.turnId === second.turnId)).toBe(true));
    expect(second.start).not.toHaveBeenCalled();
    expect(lent.acted).toEqual(["click", "set_value", "agent_browser_open", "agent_browser_click"]);
    expect(events.filter((event) => event.type === "item.started").map((event) => "title" in event && event.title)).toEqual([
      "mcp__computer__click", "mcp__computer__set_value", "mcp__browser__agent_browser_open", "mcp__browser__agent_browser_click"]);
    settle("m2", second.turnId);
    expect(patches.at(-1)).toEqual(["reply-m2", { savedSteps: { recipeId: learned.id, replayed: true } }]);

    // 3. The page now shows two Billing links: the replay stops there and the AI finishes; its run is the next revision.
    generation = "g3";
    lent.twoBillingLinks = true;
    lent.acted = [];
    const third = await send("m3");
    await vi.waitFor(() => expect(third.start).toHaveBeenCalledTimes(1));
    expect(third.start.mock.calls[0]![0].text).toContain("did steps 1–3 of 4 and failed at step 4 (click)");
    expect(saved()?.revision).toBe(1);
    await clickBilling();
    settle("m3", third.turnId);
    const repaired = saved()!;
    expect(repaired).toMatchObject({ id: learned.id, revision: 2, createdAt: learned.createdAt });
    expect(repaired.steps[3]).toEqual({ driver: "agent-browser", tool: "click", args: {}, target: { role: "link", name: "Billing", near: "Account", url: SITE } });
    expect(patches.at(-1)).toEqual(["reply-m3", { savedSteps: { recipeId: learned.id, repaired: true } }]);
  });

  it("saves nothing from a run whose screen steps were on a lent computer that is not a Mac, since they would not repeat", async () => {
    lentPlatform = "win32";
    const first = await send("m1");
    await aiRun();
    settle("m1", first.turnId);
    expect(saved()).toBeUndefined();
    expect(patches).toEqual([]);
    lentPlatform = "darwin";
  });

  it("learns and repeats a run done in the browser alone", async () => {
    const first = await send("m1");
    const web = openHarnessCaller(places().browser, "browser");
    await web.call("agent_browser_open", { url: SITE }, new AbortController().signal);
    await clickBilling();
    settle("m1", first.turnId);
    expect(saved()?.steps.map((step) => step.driver)).toEqual(["agent-browser", "agent-browser"]);
    generation = "g2";
    lent.acted = [];
    const second = await send("m2");
    await vi.waitFor(() => expect(events.some((event) => event.type === "turn.completed" && event.turnId === second.turnId)).toBe(true));
    expect(second.start).not.toHaveBeenCalled();
    expect(lent.acted).toEqual(["agent_browser_open", "agent_browser_click"]);
  });

  it("forgets a recipe whose failed run the AI could not turn into steps", async () => {
    const first = await send("m1");
    await aiRun();
    settle("m1", first.turnId);
    const learned = saved()!;
    generation = "g2";
    lent.twoBillingLinks = true;
    const second = await send("m2");
    await vi.waitFor(() => expect(second.start).toHaveBeenCalledTimes(1));
    // The AI runs a command on the lent computer, which no saved step repeats.
    await openHarnessCaller(places().localComputer, "computer").call("run_command", { command: "open -a Safari" }, new AbortController().signal);
    settle("m2", second.turnId);
    expect(steps.recipes.find("b1", learned.key)).toBeUndefined();
  });
});
