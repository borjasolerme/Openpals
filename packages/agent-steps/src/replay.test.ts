import { beforeEach, describe, expect, it } from "vitest";
import { cuaDriver } from "./cua/driver.ts";
import { requestKey } from "./key.ts";
import { createRecorder } from "./recorder.ts";
import { replay, type StepEvent } from "./replay.ts";
import { completeWindowState, windowState } from "./testing/cua-fixtures.ts";
import type { Caller, CallOutcome, Check, Patience, Recipe, Step, WebStep } from "./types.ts";
import { agentBrowserDriver } from "./web/driver.ts";

const TEXTEDIT = { bundleId: "com.apple.TextEdit", name: "TextEdit" };
const DOCUMENT = { app: TEXTEDIT, window: { title: "Untitled" }, element: { role: "AXTextArea", label: "Document", path: ["AXScrollArea:"] } };
const recipe = (steps: Step[], checks: Check[] = [], inputs: string[] = []): Recipe => ({
  version: 2, id: "r1", name: "fill the form", key: requestKey("fill the form"), request: "fill the form", revision: 1, inputs, steps, checks,
  createdAt: 1, updatedAt: 1, lastUsedAt: 1,
});
const searchFor = (text: string): WebStep => ({ driver: "agent-browser", tool: "fill", args: { text }, target: { role: "searchbox", name: "Search" } });
const clickLink = (name: string): WebStep => ({ driver: "agent-browser", tool: "click", args: {}, target: { role: "link", name } });

let acted: Array<[string, Record<string, unknown>]>;
let links: string[];
let clock: number;
const patience: Patience = { now: () => clock, sleep: async (ms) => { clock += ms; } };

/** A page with a search box and the links in `links`, refs renumbered on every snapshot. */
const browser = (fail?: string): Caller => {
  let snapshot = 0;
  return {
    async call(tool, args): Promise<CallOutcome> {
      if (tool === "agent_browser_snapshot") {
        snapshot++;
        const lines = ['- searchbox "Search" [ref=e' + snapshot + '0]', ...links.map((name, index) => `- link "${name}" [ref=e${snapshot}${index + 1}]`), "- text: Results for cats"];
        return { ok: true, structured: {}, text: lines.join("\n") };
      }
      if (tool === fail) return { ok: false, error: "the page refused" };
      acted.push([tool, args]);
      return { ok: true, structured: {} };
    },
  };
};
const desktop = (): Caller => {
  let snapshot = 2;
  return {
    async call(tool, args): Promise<CallOutcome> {
      if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: 4242, name: "TextEdit", bundle_id: "com.apple.TextEdit", running: true }] } };
      if (tool === "list_windows") return { ok: true, structured: { windows: [{ window_id: 7, pid: 4242, title: "Untitled", app_name: "TextEdit" }] } };
      if (tool === "get_window_state") return { ok: true, structured: completeWindowState(windowState(snapshot++)) };
      acted.push([tool, args]);
      return { ok: true, structured: {} };
    },
  };
};

beforeEach(() => {
  acted = [];
  links = ["Billing", "Help"];
  clock = 0;
});

describe("replay", () => {
  it("runs a recipe that crosses the desktop and the browser, with no model, finding each target afresh", async () => {
    const events: StepEvent[] = [];
    const steps: Step[] = [{ driver: "cua", tool: "click", args: {}, ...DOCUMENT }, searchFor("cats"), clickLink("Billing")];
    const out = await replay(recipe(steps), { driver: [cuaDriver(desktop()), agentBrowserDriver(browser())], patience, onStep: (event) => events.push(event) });
    expect(out).toMatchObject({ kind: "done", repaired: false, recipe: { revision: 1 } });
    expect(acted).toEqual([["click", { pid: 4242, window_id: 7, element_token: "s2-e2" }], ["agent_browser_fill", { text: "cats", selector: "@e10" }], ["agent_browser_click", { selector: "@e21" }]]);
    expect(events.map((event) => `${event.phase}:${event.tool}`)).toEqual([
      "started:click", "completed:click", "started:agent_browser_fill", "completed:agent_browser_fill", "started:agent_browser_click", "completed:agent_browser_click"]);
  });

  it("fills each {placeholder} from the inputs, and stops before acting when one is missing", async () => {
    const steps = [searchFor("{animal}")];
    expect(await replay(recipe(steps, [], ["animal"]), { driver: agentBrowserDriver(browser()), inputs: { animal: "otters" }, patience })).toMatchObject({ kind: "done" });
    expect(acted).toEqual([["agent_browser_fill", { text: "otters", selector: "@e10" }]]);
    expect(await replay(recipe(steps, [], ["animal"]), { driver: agentBrowserDriver(browser()), patience })).toMatchObject({ kind: "failed", index: 0, error: "no value for {animal}" });
    expect(acted).toHaveLength(1);
  });

  it("verifies its checks at the end", async () => {
    const seen: Check = { kind: "text-visible", driver: "agent-browser", text: "Results for cats" };
    expect(await replay(recipe([searchFor("cats")], [seen]), { driver: agentBrowserDriver(browser()), patience })).toMatchObject({ kind: "done" });
    const missing: Check = { ...seen, text: "Results for dogs" };
    expect(await replay(recipe([searchFor("cats")], [missing]), { driver: agentBrowserDriver(browser()), patience }))
      .toMatchObject({ kind: "failed", check: true, tool: "check", label: '"Results for dogs"', error: '"Results for dogs" is not visible' });
  });

  it("hands a step that cannot be found to repair, runs what it returns, and returns the recipe one revision on", async () => {
    links = ["Invoices", "Help"];
    const asked: Array<[Step, number, string]> = [];
    const out = await replay(recipe([searchFor("cats"), clickLink("Billing")]), {
      driver: agentBrowserDriver(browser()), patience, now: () => 99,
      repair: async (step, context) => {
        asked.push([step, context.index, context.error]);
        return [clickLink("Invoices")];
      },
    });
    expect(asked).toEqual([[clickLink("Billing"), 1, 'no "Billing" (link) on the page']]);
    expect(out).toMatchObject({ kind: "done", repaired: true, recipe: { id: "r1", revision: 2, updatedAt: 99, steps: [searchFor("cats"), clickLink("Invoices")] } });
    expect(acted.map(([tool]) => tool)).toEqual(["agent_browser_fill", "agent_browser_click"]);
  });

  it("repairs once per run, never with a step its policy refuses, and never a step a person's hold stopped", async () => {
    links = [];
    let repairs = 0;
    const tryAgain = async () => { repairs++; return [clickLink("Elsewhere")]; };
    expect(await replay(recipe([clickLink("Billing")]), { driver: agentBrowserDriver(browser()), patience, repair: tryAgain })).toMatchObject({ kind: "failed", error: 'no "Elsewhere" (link) on the page' });
    expect(repairs).toBe(1);
    const unsafe = async () => [{ ...clickLink("Delete account") }];
    expect(await replay(recipe([clickLink("Billing")]), { driver: agentBrowserDriver(browser()), patience, repair: unsafe })).toMatchObject({ kind: "failed", error: 'no "Billing" (link) on the page' });
    const held: Caller = { call: async () => ({ ok: false, error: "A person is using this computer.", gate: true }) };
    expect(await replay(recipe([clickLink("Billing")]), { driver: agentBrowserDriver(held), patience, repair: tryAgain })).toMatchObject({ kind: "failed", gate: true });
    expect(repairs).toBe(1);
  });

  it("asks before each step and stops at a no, or when stopped", async () => {
    expect(await replay(recipe([searchFor("cats"), clickLink("Billing")]), { driver: agentBrowserDriver(browser()), patience, approve: async (_step, index) => index === 0 }))
      .toEqual({ kind: "declined", index: 1, tool: "click", label: '"Billing" link' });
    const controller = new AbortController();
    controller.abort();
    expect(await replay(recipe([searchFor("cats")]), { driver: agentBrowserDriver(browser()), signal: controller.signal })).toEqual({ kind: "stopped" });
  });

  it("refuses a step whose driver it was not given", async () => {
    expect(await replay(recipe([{ driver: "cua", tool: "click", args: {}, ...DOCUMENT }]), { driver: agentBrowserDriver(browser()), patience }))
      .toMatchObject({ kind: "failed", error: "no cua driver to run this step" });
  });
});

describe("createRecorder", () => {
  it("records calls made through it, turns typed values into placeholders, and adds checks", async () => {
    const recorder = createRecorder({ driver: agentBrowserDriver(browser()), now: () => 5, id: () => "rec-1" });
    await recorder.call("agent_browser_open", { url: "https://example.com/" });
    await recorder.call("agent_browser_snapshot", {});
    await recorder.call("agent_browser_fill", { selector: "@e10", text: "cats" });
    await recorder.call("agent_browser_click", { selector: "@e11" });
    const out = recorder.stop({ name: "Search the site", inputs: { animal: "cats" }, checks: ["Results for"] });
    if (!out.ok) throw new Error(out.reason);
    expect(out.recipe).toMatchObject({ id: "rec-1", name: "Search the site", key: "search the site", revision: 1, inputs: ["animal"], createdAt: 5,
      checks: [{ kind: "text-visible", driver: "agent-browser", text: "Results for" }] });
    expect(out.recipe.steps.slice(1)).toEqual([
      { driver: "agent-browser", tool: "fill", args: { text: "{animal}" }, target: { role: "searchbox", name: "Search", url: "https://example.com/" } },
      { driver: "agent-browser", tool: "click", args: {}, target: { role: "link", name: "Billing", url: "https://example.com/" } },
    ]);
    expect(await replay(out.recipe, { driver: agentBrowserDriver(browser()), inputs: { animal: "owls" }, patience, policy: "standard" })).toMatchObject({ kind: "done" });
    expect(acted).toContainEqual(["agent_browser_fill", { text: "owls", selector: "@e10" }]);
  });

  it("says why a recording makes no recipe", async () => {
    const recorder = createRecorder({ driver: agentBrowserDriver(browser()) });
    await recorder.call("agent_browser_snapshot", {});
    expect(recorder.stop({ name: "nothing" })).toEqual({ ok: false, reason: "no-steps" });
    expect(await recorder.call("list_apps", {})).toEqual({ ok: false, error: "no driver for list_apps" });
  });
});
