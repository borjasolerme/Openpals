import { describe, expect, it, vi } from "vitest";
import type { BrowserRuntime } from "../browser-runtime.ts";
import { CHROME_ENGINE, RuntimeRouter, type ChromeEngine } from "./engines.ts";
import { passkeyAnnotation, passkeyNotice, withPasskeyNotice } from "./passkey-notice.ts";

const page = (text: string) => ({ content: [{ type: "text", text }] });
const PASSKEY_PAGE = 'heading "Google"\nheading "Verifying it’s you"\ntext "Complete sign-in using your passkey"\nbutton "Try another way"';
const texts = (result: unknown) => (result as { content: Array<{ text: string }> }).content.map((part) => part.text);

describe("the passkey notice a bot gets", () => {
  it("orders what works: connected apps first, then another way with a code", () => {
    const notice = passkeyNotice("google");
    const works = notice.slice(notice.indexOf("What works, best first"));
    expect(works.indexOf("connected apps")).toBeLessThan(works.indexOf("Try another way"));
    expect(notice).toContain("COMPOSIO_MANAGE_CONNECTIONS");
    expect(notice).toContain("request_sign_in");
    expect(notice).toContain("do not retry, wait, or press Continue or Try again");
    expect(notice).toContain("this Google account wants a passkey");
    expect(notice.indexOf("Choose \"Try another way\" on this page")).toBeLessThan(notice.indexOf("connected apps"));
    expect(notice).toContain("take a snapshot to see them), or use the person's own computer's browser");
    expect(passkeyNotice("microsoft")).toContain("\"Other ways to sign in\"");
  });

  it("is added to an answer that shows a passkey step, and nowhere else", () => {
    expect(texts(withPasskeyNotice(page(PASSKEY_PAGE)))).toEqual([PASSKEY_PAGE, passkeyNotice("google")]);
    const password = page('heading "Google"\nheading "Welcome"\ntextbox "Enter your password"');
    expect(withPasskeyNotice(password)).toBe(password);
    expect(withPasskeyNotice({ isError: true })).toEqual({ isError: true });
  });
});

describe("the runtime router annotates tool answers from either engine", () => {
  const annotate = passkeyAnnotation();
  const old = { agentRpc: vi.fn(async () => page(PASSKEY_PAGE)) } as unknown as BrowserRuntime;
  const chrome = { service: { agentRpc: vi.fn(async () => page(PASSKEY_PAGE)) } } as unknown as ChromeEngine;
  const router = new RuntimeRouter(old, chrome, { annotate });
  const call = { name: "agent_browser_snapshot", arguments: {} };

  it("on agent-browser and on the Chrome engine, for calls but not the tool list", async () => {
    expect(texts(await router.agentRpc("s1", { command: "agent-browser", args: [], env: {} }, "tools/call", call)).at(-1)).toBe(passkeyNotice("google"));
    expect(texts(await router.agentRpc("s2", { command: CHROME_ENGINE, args: ["bot:b"], env: {} }, "tools/call", call)).at(-1)).toBe(passkeyNotice("google"));
    expect(texts(await router.agentRpc("s1", { command: "agent-browser", args: [], env: {} }, "tools/list", {}))).toEqual([PASSKEY_PAGE]);
  });

  it("not in the person's own Chrome, where their passkey works", async () => {
    expect(texts(await router.agentRpc("s3", { command: "agent-browser", args: [], env: { AGENT_BROWSER_AUTO_CONNECT: "1" } }, "tools/call", call))).toEqual([PASSKEY_PAGE]);
  });
});
