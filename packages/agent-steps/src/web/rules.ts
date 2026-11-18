// How a browser recording (agent-browser's tools) becomes steps, and what a browser step may never do. A step names the
// element it acted on by role and name from the snapshot read before it, never by its ref or a CSS selector.
import type { LearnContext, Learned, Policy, RecordedCall, Refusal, WebStep, WebTarget, WebTool } from "../types.ts";
import { namesFinalAction, namesSecret } from "../words.ts";
import { matching, pageOf, readSnapshot, refOf, type SnapshotNode } from "./snapshot.ts";

export const WEB_PREFIX = "agent_browser_";

/** The arguments each tool keeps besides its selector; any other argument refuses the recording. */
export const WEB_KEPT_ARGS: Record<WebTool, readonly string[]> = {
  open: ["url"],
  click: ["button", "newTab"],
  dblclick: [],
  fill: ["text"],
  press: ["key"],
  check: [],
  uncheck: [],
  select: ["values", "value"],
  scroll: ["direction", "amount"],
  hover: [],
  back: [],
  forward: [],
  reload: [],
};
/** Tools that act on one element and need it named. `press` and `scroll` name one only when given a selector. */
const TARGETED: ReadonlySet<WebTool> = new Set<WebTool>(["click", "dblclick", "fill", "check", "uncheck", "select", "hover"]);
const MAY_TARGET: ReadonlySet<WebTool> = new Set<WebTool>(["press", "scroll"]);
const ACTIVATING: ReadonlySet<WebTool> = new Set<WebTool>(["click", "dblclick", "press"]);
const OBSERVING = /^(snapshot|screenshot|read|get_\w+|is_\w+|wait\w*|find\w*|console|errors)$/u;
const TOGGLE_ROLE = /checkbox|switch|radio|menuitemcheckbox|menuitemradio/iu;
const TEXT_ROLE = /textbox|searchbox|combobox|spinbutton/iu;
const SECRET_NAME = /pass|pwd|otp|one.?time|2fa|mfa|security.?code|verif\w*.?code|cvc|cvv|card.?num|\bpin\b|ssn|secret|token/iu;
const RETURN_KEYS = new Set(["enter", "return", "numpadenter"]);
const DELETE_KEYS = new Set(["delete", "backspace"]);
const COMMAND_KEYS = new Set(["control", "ctrl", "meta", "cmd", "command"]);

const isWebTool = (name: string): name is WebTool => Object.hasOwn(WEB_KEPT_ARGS, name);
const shortName = (tool: string) => (tool.startsWith(WEB_PREFIX) ? tool.slice(WEB_PREFIX.length) : tool);

export const webOwns = (tool: string): boolean => tool.startsWith(WEB_PREFIX);

/** The keys a press holds, lower case: "Control+Enter" is control and enter. */
function keysOf(step: Pick<WebStep, "tool" | "args">): string[] {
  return step.tool === "press" && typeof step.args.key === "string" ? step.args.key.toLowerCase().split("+").map((key) => key.trim()) : [];
}

/** Security invariant: no saved browser step activates a final action (send, delete, pay and their like), toggles a
 * box from an unknown state, or types into a secret field. */
export function unsafeWebStep(step: Pick<WebStep, "tool" | "args" | "target">, page: readonly SnapshotNode[] = []): Refusal | null {
  const { tool, target } = step;
  if (target) {
    if (TEXT_ROLE.test(target.role) && (namesSecret(target.name) || SECRET_NAME.test(target.name)) && (tool === "fill" || tool === "press")) return "secret-field";
    if (/password/iu.test(target.role)) return "secret-field";
    if ((tool === "click" || tool === "dblclick") && TOGGLE_ROLE.test(target.role)) return "toggle-element";
    if (ACTIVATING.has(tool) && [target.name, target.near].some(namesFinalAction)) return "final-action";
    if (tool === "select" && [step.args.value, ...(Array.isArray(step.args.values) ? step.args.values : [])].some((value) => typeof value === "string" && namesFinalAction(value))) return "final-action";
  }
  const keys = keysOf(step);
  if (keys.some((key) => DELETE_KEYS.has(key))) return "final-action";
  if (keys.some((key) => RETURN_KEYS.has(key)) && (keys.some((key) => COMMAND_KEYS.has(key)) || page.some((node) => namesFinalAction(node.name)))) return "final-action";
  if (tool === "open" && typeof step.args.url === "string" && namesFinalAction(step.args.url)) return "final-action";
  return null;
}

/** Why a saved browser step must not run. Checked again on every load. */
export function webRefusal(step: WebStep, _policy: Policy): Refusal | null {
  if (!isWebTool(step.tool)) return "unknown-tool";
  if (!Object.keys(step.args).every((name) => WEB_KEPT_ARGS[step.tool].includes(name))) return "extra-arguments";
  if (TARGETED.has(step.tool) && !step.target) return "unknown-target";
  if (step.target && (!step.target.name || !step.target.role)) return "unlabelled-element";
  if (step.tool === "open" && pageOf(step.args.url) === undefined) return "unknown-target";
  return unsafeWebStep(step);
}

/** A site's home page alone is not the person's words; any other link is. */
const bareOrigin = (url: unknown): boolean => {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return (parsed.pathname === "/" || parsed.pathname === "") && !parsed.search && !parsed.hash && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

export function webWords(step: WebStep): { typed: unknown[]; urls: unknown[] } {
  const typed = step.tool === "fill" ? [step.args.text]
    : step.tool === "select" ? [...(step.args.value !== undefined ? [step.args.value] : []), ...(Array.isArray(step.args.values) ? step.args.values : step.args.values !== undefined ? [undefined] : [])]
    : [];
  return { typed, urls: step.tool === "open" && !bareOrigin(step.args.url) ? [step.args.url] : [] };
}

export function webLabel(step: WebStep): string {
  if (step.target) return `"${step.target.name}" ${step.target.role}`;
  if (step.tool === "open" && typeof step.args.url === "string") return pageOf(step.args.url) ?? "a page";
  return "the page";
}

const urlIn = (text: string | undefined): string | undefined => {
  const line = text?.trim();
  if (!line) return undefined;
  if (pageOf(line)) return line;
  return /^(?:page )?url:\s*(\S+)/imu.exec(line)?.[1];
};

/** Steps from a browser recording. Each element a step acts on is named from the snapshot read before it, and must be
 * the only one of its role and name there (or with the heading above it). */
export function learnWeb(calls: readonly RecordedCall[], _context: LearnContext): Learned<WebStep> {
  const refuse = (reason: Refusal) => ({ ok: false as const, reason });
  const steps: Array<{ at: number; step: WebStep }> = [];
  let page: SnapshotNode[] = [];
  let url: string | undefined;
  for (const [at, call] of calls.entries()) {
    const { arguments: args, result } = call;
    const tool = shortName(call.tool);
    if (result.isError || result.rpcError) return refuse("tool-error");
    const seen = readSnapshot(result.text ?? "");
    if (OBSERVING.test(tool)) {
      if (seen.length) page = seen;
      url = (tool === "get_url" ? urlIn(result.text) : undefined) ?? url;
      continue;
    }
    if (tool === "type") return refuse("typing-appends");
    if (!isWebTool(tool)) return refuse("unknown-tool");
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (key === "selector") continue;
      if (!WEB_KEPT_ARGS[tool].includes(key)) return refuse("extra-arguments");
      kept[key] = value;
    }
    const step: WebStep = { driver: "agent-browser", tool, args: kept };
    if (args.selector !== undefined) {
      if (!TARGETED.has(tool) && !MAY_TARGET.has(tool)) return refuse("extra-arguments");
      const ref = refOf(args.selector);
      const node = ref === undefined ? undefined : page.find((candidate) => candidate.ref === ref);
      if (!node) return refuse("unknown-target");
      if (!node.name) return refuse("unlabelled-element");
      const target: WebTarget = { role: node.role, name: node.name, ...(node.frame ? { frame: true as const } : {}) };
      if (matching(page, target).length > 1) {
        if (node.near === undefined || matching(page, { ...target, near: node.near }).length > 1) return refuse("ambiguous-element");
        target.near = node.near;
      }
      const here = pageOf(url);
      if (here) target.url = here;
      step.target = target;
    } else if (TARGETED.has(tool)) return refuse("unknown-target");
    if (tool === "open" && pageOf(args.url) === undefined) return refuse("unknown-target");
    const unsafe = unsafeWebStep(step, page);
    if (unsafe) return refuse(unsafe);
    steps.push({ at, step });
    // An action may answer with the page it led to. A new page's refs are not the old one's; a click or a key may have
    // left the page, so where it is stays unknown until something says.
    const navigates = tool === "open" || tool === "back" || tool === "forward" || tool === "reload";
    page = seen.length ? seen : navigates ? [] : page;
    if (navigates || ACTIVATING.has(tool)) url = tool === "open" ? (args.url as string) : undefined;
    url = urlIn(/^(?:page )?url:.*$/imu.exec(result.text ?? "")?.[0]) ?? url;
  }
  return { ok: true, steps };
}
