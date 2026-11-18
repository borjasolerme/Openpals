// What a bot is told when it uses the apps and screen of a computer lent to this server. The desktop relays cua-driver's
// answers unchanged and older desktops send raw failures, so the plain fix is added here, on the server.
import { textOnlyErrorResult } from "./mcp-error-result.ts";
import { CLICK_TOOLS, unconfirmedClickResult } from "./unconfirmed-click.ts";

type Part = { type?: unknown; text?: unknown };
type ToolResult = { content?: Part[]; isError?: boolean };

/** A web page through the screen of the lent computer: how bots browse there without Chrome connected, and the fallback with it. */
const SCREEN_WAY = "launch_app with urls opens the page in their Chrome; read it with get_window_state (include_screenshot when the tree is thin) and act with click, type_text and press_key.";

/** The person chose this lent computer as where the bot works, so a website is done in its browser, signed in as they are. */
const THIS_BROWSER = `For a website, use the browser on this lent computer, signed in as the person. When your instructions say your agent_browser_* tools drive their Chrome there, use those first; otherwise, or whenever one of them fails, use the screen: ${SCREEN_WAY} Without their Chrome connected, agent_browser_* is your own browser on the server: use it only when the person asks for it.`;

export const LENT_SCREEN_BROWSING =
  `${THIS_BROWSER} get_browser_state and the browser_* tools can't drive a browser on a lent computer: don't use them, and never ask the person to turn on remote debugging.`;

/** Added to every failed browser call in the person's Chrome: the screen tools still work there, exactly as without Chrome. */
export const LENT_BROWSER_FALLBACK = `Do this page with the screen tools on this computer instead, as you would without their Chrome connected: ${SCREEN_WAY}`;

/** The person connected their Chrome there: websites go through the browser tools first, which act without the mouse. */
export function lentChromeBrowsing(name: string): string {
  return `For a website, use your agent_browser_* tools first: on this computer they drive the person's own Chrome on ${name}, signed in as they are, without taking the mouse, so it works even while the person uses the computer. agent_browser_open opens your page in a new tab of their Chrome; work only in tabs you opened, and never close the person's own tabs unless they ask. Your screen tools stay available: if the agent_browser_* tools are missing, Chrome isn't connected, or a browser call fails, do the page with the screen instead, as you would without Chrome: ${SCREEN_WAY} Use the screen tools too for apps that aren't web pages.`;
}

/** Without Chrome connected there, the screen is the way to a website; the person can connect Chrome for the browser tools. */
export const LENT_CHROME_OFFER =
  "If browsing by screen is slow or the person is using the computer, tell them once that they can turn on \"Use my Chrome without the mouse\" in Openpals on that computer (Settings → Computer), so you can use their Chrome without the mouse.";

/** Bots probed a lent Mac with uname or whoami before opening a page, and read a slow answer as the computer being gone. */
export const LENT_NO_PROBES =
  "Don't run commands to check whether this computer works: go straight to the task with its screen tools. If a screen call says Openpals needs permission, tell the person exactly which macOS permissions to turn on instead of saying the computer isn't responding.";

/** The person may be using the computer while a bot does: background actions run, foreground ones wait for them to step away. */
export const LENT_SCREEN_BACKGROUND =
  "The person may be using this computer while you work. Act in the background so you never take their mouse or keyboard: give the app's pid and window_id (from launch_app or list_windows) and act on elements from get_window_state. A call with delivery_mode \"foreground\", scope \"desktop\", drag, bring_to_front or no window waits until they have stepped away. Inside a web page (Chrome or another browser) a background click often doesn't land: read the window again with get_window_state, and if nothing changed, do it with delivery_mode \"foreground\" on the same pid and window_id; when the person is using the computer that call says so, so wait a minute and try again.";

export const LENT_BROWSER_NO_ENDPOINT =
  `get_browser_state and the browser_* tools can't drive a browser on a lent computer: do not retry them, and never ask the person to turn on remote debugging. ${THIS_BROWSER}`;

/** cua-driver 0.12.6 and 0.28.2 name a browser that needs browser_prepare with these codes. */
const NEEDS_SETUP = /\bbrowser_(?:requires_setup|route_unavailable)\b/u;

const RAW_FAILURES: ReadonlyArray<[RegExp, string]> = [
  [/\bspawn\b.*\bcua-driver(?:\.exe)?\b.*\b(?:ENOENT|EPERM|EACCES|EBUSY|UNKNOWN)\b|\bcua-driver binary not found\b/iu,
    "Computer control could not start on this computer: its helper, cua-driver, is missing or blocked. Tell the person in one sentence: Windows Security may have quarantined it, so on that PC open Windows Security → Virus & threat protection → Protection history, restore or allow cua-driver.exe (or reinstall Openpals), then restart Openpals. Do not retry until they say it is fixed."],
  [/^Computer-control transport closed$/u,
    "Computer control stopped on this computer: its helper, cua-driver, exited. Try the action once more; if it fails the same way, tell the person that Windows Security may have quarantined cua-driver.exe (restore it from Protection history, or reinstall Openpals) and to restart Openpals."],
  [/^Computer control is unavailable\. Enable it in the local app and grant OS permissions first\.$/u,
    "Computer control is not running on this computer. Tell the person in one sentence to open Openpals on it: on Windows, restore cua-driver.exe if Windows Security quarantined it (Protection history) or reinstall; on a Mac, allow Accessibility and Screen Recording for Openpals. Then try again."],
  // Older desktops say this for any failed screen check, though it is rarely a person.
  [/^This computer is in use locally or held by a person\. Wait, then observe it again before acting\.$/u,
    "This computer did not let this call use its screen, so it was not performed. Another bot on it may be using the screen, or Openpals on it could not check; it is not necessarily a person. Try again in a minute; if it keeps saying this, tell the person to update Openpals on that computer, or quit and reopen it."],
  [/^fetch failed$/u,
    "Openpals on this computer is not answering its own screen-control check. Tell the person to restart Openpals on that computer, then try again."],
];

function textOf(result: ToolResult): string {
  return (result.content ?? []).map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : "")).join("\n").trim();
}

const withPart = (result: ToolResult, text: string): ToolResult => ({ ...result, content: [...(result.content ?? []), { type: "text", text }] });

export function lentScreenResult(operation: { action: string; tool_name?: string }, value: unknown): unknown {
  if (operation.action !== "computer_tools" && operation.action !== "computer_call") return value;
  if (!value || typeof value !== "object" || !Array.isArray((value as ToolResult).content)) return value;
  const result = textOnlyErrorResult(value as ToolResult);
  if (operation.action === "computer_tools") return result.isError ? result : withPart(withPart(result, LENT_SCREEN_BROWSING), LENT_SCREEN_BACKGROUND);
  const sent = CLICK_TOOLS.has(operation.tool_name ?? "") ? unconfirmedClickResult(result) : null;
  if (sent) return sent;
  if (result.isError) {
    const text = textOf(result);
    const fix = RAW_FAILURES.find(([pattern]) => pattern.test(text));
    if (fix) return { ...result, content: [{ type: "text", text: fix[1] }] };
  }
  const browser = operation.tool_name === "browser_prepare" || operation.tool_name === "get_browser_state" || operation.tool_name?.startsWith("browser_");
  if (browser && (NEEDS_SETUP.test(JSON.stringify(result)) || (result.isError && operation.tool_name === "browser_prepare"))) {
    return withPart(result, LENT_BROWSER_NO_ENDPOINT);
  }
  return result;
}
