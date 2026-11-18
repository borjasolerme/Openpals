import { describe, expect, it } from "vitest";
import { learnRecipe } from "../recipe.ts";
import type { Caller, CallOutcome, RecordedCall, WebStep } from "../types.ts";
import { agentBrowserDriver } from "./driver.ts";
import { readSnapshot } from "./snapshot.ts";

const PAGE = [
  '- banner "Top" [ref=e1]',
  '  - link "Home" [ref=e2]',
  '- main [ref=e3]',
  '  - heading "Account" [level=1, ref=e4]',
  '  - link "Billing" [ref=e5]',
  '  - searchbox "Search" [ref=e6]',
  '  - textbox "Password" [ref=e7]',
  '  - checkbox "Remember me" [ref=e8]',
  '  - button "Send invoice" [ref=e9]',
  '  - heading "Help" [level=2, ref=e10]',
  '  - link "Billing" [ref=e11]',
  '  - iframe [ref=e12]',
  '    - button "Pay" [ref=e13]',
  '  - text: Welcome back',
].join("\n");

const call = (tool: string, args: Record<string, unknown> = {}, text?: string): RecordedCall => ({ tool: `agent_browser_${tool}`, arguments: args, result: { isError: false, ...(text ? { text } : {}) } });
const learn = (calls: RecordedCall[], request = "search for cats on example.com") =>
  learnRecipe({ calls, drivers: [agentBrowserDriver()], request, policy: "strict", id: "r1", now: 1 });
const OPENED = [call("open", { url: "https://example.com/" }), call("snapshot", {}, PAGE)];

describe("readSnapshot", () => {
  it("reads each element's role, name, ref, the heading or landmark above it, and whether it is in a frame", () => {
    const nodes = readSnapshot(PAGE);
    expect(nodes.find((node) => node.ref === "e5")).toEqual({ ref: "e5", role: "link", name: "Billing", near: "Account" });
    expect(nodes.find((node) => node.ref === "e11")).toEqual({ ref: "e11", role: "link", name: "Billing", near: "Help" });
    expect(nodes.find((node) => node.ref === "e13")).toEqual({ ref: "e13", role: "button", name: "Pay", near: "Help", frame: true });
    expect(readSnapshot("no snapshot here")).toEqual([]);
  });
});

describe("learning browser steps", () => {
  it("names each element by role and name, never by its ref", () => {
    const out = learn([...OPENED, call("fill", { selector: "@e6", text: "cats" }), call("press", { key: "Tab" })]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.recipe.steps).toEqual([
      { driver: "agent-browser", tool: "open", args: { url: "https://example.com/" } },
      { driver: "agent-browser", tool: "fill", args: { text: "cats" }, target: { role: "searchbox", name: "Search", url: "https://example.com/" } },
      { driver: "agent-browser", tool: "press", args: { key: "Tab" } },
    ]);
    expect(JSON.stringify(out.recipe)).not.toContain("e6");
  });

  it("tells two elements with one role and name apart by the heading above them", () => {
    const out = learn([...OPENED, call("click", { selector: "e11" })]);
    expect(out.ok && out.recipe.steps[1]).toEqual({ driver: "agent-browser", tool: "click", args: {}, target: { role: "link", name: "Billing", near: "Help", url: "https://example.com/" } });
  });

  it("forgets where it is once a click may have left the page", () => {
    const out = learn([...OPENED, call("click", { selector: "@e5" }), call("snapshot", {}, PAGE), call("click", { selector: "@e2" })]);
    expect(out.ok && (out.recipe.steps[2] as WebStep).target).toEqual({ role: "link", name: "Home" });
  });

  it.each<[string, RecordedCall[], string?]>([
    ["unknown-target", [...OPENED, call("click", { selector: "@e99" })]],
    ["unknown-target", [...OPENED, call("click", { selector: "#billing" })]],
    ["unknown-target", [call("click", { selector: "@e5" })]],
    ["unknown-target", [call("open", { url: "file:///etc/passwd" })]],
    ["unlabelled-element", [...OPENED, call("click", { selector: "@e3" })]],
    ["final-action", [...OPENED, call("click", { selector: "@e9" })]],
    ["final-action", [...OPENED, call("press", { key: "Enter" })]],
    ["final-action", [...OPENED, call("press", { key: "Backspace" })]],
    ["secret-field", [...OPENED, call("fill", { selector: "@e7", text: "cats" })]],
    ["toggle-element", [...OPENED, call("click", { selector: "@e8" })]],
    ["typing-appends", [...OPENED, call("type", { selector: "@e6", text: "cats" })]],
    ["unknown-tool", [...OPENED, call("eval", { script: "1" })]],
    ["extra-arguments", [...OPENED, call("click", { selector: "@e5", force: true })]],
    ["typed-text-not-in-request", [...OPENED, call("fill", { selector: "@e6", text: "dogs" })]],
    ["url-not-in-request", [call("open", { url: "https://example.com/account/42" })]],
    ["moment-words", OPENED, "search for this on example.com"],
    ["tool-error", [{ ...call("click", { selector: "@e5" }), result: { isError: true } }]],
  ])("refuses: %s %#", (reason, calls, request) => expect(learn(calls, request)).toEqual({ ok: false, reason }));

  it("keeps a checkbox step that sets a state rather than flips one", () => {
    expect(learn([...OPENED, call("check", { selector: "@e8" })]).ok).toBe(true);
  });

  it("presses Enter only on a page that shows no final action", () => {
    const quiet = '- searchbox "Search" [ref=e1]\n- link "Help" [ref=e2]';
    expect(learn([call("open", { url: "https://example.com/" }), call("snapshot", {}, quiet), call("press", { key: "Enter" })]).ok).toBe(true);
  });
});

describe("agentBrowserDriver", () => {
  const caller = (snapshot: string, url = "https://example.com/"): Caller & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      async call(tool): Promise<CallOutcome> {
        calls.push(tool);
        if (tool === "agent_browser_snapshot") return { ok: true, structured: {}, text: snapshot };
        if (tool === "agent_browser_get_url") return { ok: true, structured: {}, text: url };
        return { ok: true, structured: {} };
      },
    };
  };
  const signal = new AbortController().signal;
  const step = (target: WebStep["target"]): WebStep => ({ driver: "agent-browser", tool: "click", args: {}, target });

  it("acts on the ref the page shows now for the saved role and name", async () => {
    const renumbered = PAGE.replace("[ref=e5]", "[ref=e50]");
    expect(await agentBrowserDriver(caller(renumbered)).resolve(step({ role: "link", name: "Billing", near: "Account" }), signal))
      .toEqual({ ok: true, tool: "agent_browser_click", args: { selector: "@e50" } });
  });

  it("waits for a page that is not there yet, and never guesses between two matches", async () => {
    const driver = agentBrowserDriver(caller(PAGE, "https://example.com/login"));
    expect(await driver.resolve(step({ role: "link", name: "Billing", near: "Account", url: "https://example.com/" }), signal))
      .toEqual({ ok: false, error: "the page is https://example.com/login, not https://example.com/", missing: true });
    expect(await agentBrowserDriver(caller(PAGE)).resolve(step({ role: "link", name: "Billing" }), signal))
      .toEqual({ ok: false, error: 'more than one "Billing" (link) on the page' });
    expect(await agentBrowserDriver(caller(PAGE)).resolve(step({ role: "link", name: "Invoices" }), signal))
      .toEqual({ ok: false, error: 'no "Invoices" (link) on the page', missing: true });
  });

  it("finds an element inside a frame only as one inside a frame", async () => {
    const driver = agentBrowserDriver(caller(PAGE));
    expect(await driver.resolve(step({ role: "button", name: "Pay" }), signal)).toMatchObject({ ok: false, missing: true });
    expect(await driver.resolve(step({ role: "button", name: "Pay", frame: true }), signal)).toMatchObject({ ok: true, args: { selector: "@e13" } });
  });

  it("reads a check from the page's snapshot", async () => {
    const driver = agentBrowserDriver(caller(PAGE));
    expect(await driver.sees({ kind: "text-visible", driver: "agent-browser", text: "Welcome back" }, signal)).toEqual({ ok: true, seen: true });
    expect(await driver.sees({ kind: "text-visible", driver: "agent-browser", text: "Goodbye" }, signal)).toEqual({ ok: true, seen: false });
  });
});
