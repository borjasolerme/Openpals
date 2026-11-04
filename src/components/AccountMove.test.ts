import { createElement, type EffectCallback, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudSendNotice, CloudSendPageBridge } from "../../electron/cloud-send.mjs";
import type { OneHomeView } from "../../electron/one-home.mjs";
import { moveLine } from "@/lib/cloud-send";
import { setLocale } from "@/lib/i18n";
const f = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = initial; return [f.values[index], (next: unknown) => { f.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(f.values[index]) : next; }]; },
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
import { AccountMoveStatus, accountMoveWords, moveMenuItems, useAccountMove, useAccountMoveLine, type AccountMoveLine } from "./AccountMove";

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const markup = (node: ReactNode) => renderToStaticMarkup(createElement("div", null, node)).replaceAll("&#x27;", "'");
const noop = () => {};
const tryAgainTag = (html: string) => html.match(/<button[^>]*data-move-retry[^>]*>/)?.[0] ?? "";
const place = "Garage server";
const line = (move: OneHomeView) => moveLine({ place, ...move }) as AccountMoveLine;

const notice = { ready: true, bots: ["Ember"], updatedBots: [], skills: 2, logins: 0, onePassword: true, settings: 0, signature: "sig-1", dismissed: false, running: false, last: null, whole: null } as unknown as CloudSendNotice;
let page: CloudSendPageBridge;
const open = vi.fn();
const hook = () => { f.index = 0; f.effects = []; return useAccountMove({ onOpen: open }); };
const lineHook = () => { f.index = 0; f.effects = []; return useAccountMoveLine(); };
async function shown(value: CloudSendNotice) {
  page = { notice: vi.fn().mockResolvedValue(value), dismiss: vi.fn().mockResolvedValue({ ...value, move: undefined }), moveRetry: vi.fn().mockResolvedValue(value), onNotice: vi.fn(() => () => {}) };
  vi.stubGlobal("window", { ogb: { cloudSendPage: page } });
  hook(); for (const effect of f.effects) effect(); await flush();
  return hook();
}

beforeEach(() => { f.values = []; f.index = 0; f.effects = []; setLocale("en"); open.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the move's words on the account", () => {
  it("needs the person once failing, goes quietly while on its way, and names the server", () => {
    expect(accountMoveWords("failed", place)).toBe("Garage server move needs you");
    expect(accountMoveWords("sending", place)).toBe("Moving to Garage server…");
    expect(accountMoveWords(null, place)).toBeNull();
    expect(accountMoveWords("sending")).toBeNull();
    expect(markup(AccountMoveStatus({ kind: "sending", place }))).toContain("Moving to Garage server…");
  });

  it("is a button that opens the account menu by the account, and plain words inside a trigger", () => {
    const opened = vi.fn();
    const failed = markup(AccountMoveStatus({ kind: "failed", place, onOpen: opened }));
    expect(failed).toContain('data-account-move="failed"');
    expect(failed).toContain("text-warning");
    expect(failed).toContain("<button");
    expect(markup(AccountMoveStatus({ kind: "sending", place, onOpen: opened }))).not.toContain("text-warning");
    expect(markup(AccountMoveStatus({ kind: "failed", place }))).not.toContain("<button");
    expect(AccountMoveStatus({ kind: null })).toBeNull();
  });

  it("ends with Try again, a button of its own named for the move, that runs the retry", () => {
    const onRetry = vi.fn();
    const status = AccountMoveStatus({ kind: "failed", place, onOpen: noop, retry: { onRetry, retrying: false, why: "Garage server did not answer." } }) as ReturnType<typeof createElement>;
    const html = markup(status);
    const tag = tryAgainTag(html);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(tag).toContain('aria-label="Try again to move to Garage server"');
    expect(tag).toContain('title="Garage server did not answer."');
    expect(tag).not.toContain("aria-disabled");
    const tryAgain = (status.props as { children: ReturnType<typeof createElement>[] }).children[1]!;
    (tryAgain.props as { onClick: () => void }).onClick();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("while Try again runs: disabled and busy, with a spinner", () => {
    const tag = tryAgainTag(markup(AccountMoveStatus({ kind: "failed", place, onOpen: noop, retry: { onRetry: noop, retrying: true, why: "" } })));
    expect(tag).toContain('aria-busy="true"');
    expect(tag).toContain('aria-disabled="true"');
  });

  it("has no Try again on its way, inside a trigger, or when the move allows none", () => {
    const retry = { onRetry: noop, retrying: false, why: "" };
    expect(markup(AccountMoveStatus({ kind: "sending", place, onOpen: noop, retry }))).not.toContain("Try again");
    expect(markup(AccountMoveStatus({ kind: "failed", place, retry }))).not.toContain("Try again");
    expect(markup(AccountMoveStatus({ kind: "failed", place, onOpen: noop }))).not.toContain("Try again");
  });
});

describe("the move's row in the account menu", () => {
  const rows = (value: AccountMoveLine | null, patch: Partial<Parameters<typeof moveMenuItems>[1]> = {}) =>
    moveMenuItems(value, { onOpen: noop, onRetry: noop, ...patch });

  it("failing: one row that tries again, with why in its tooltip", () => {
    const onOpen = vi.fn(), onRetry = vi.fn();
    const items = rows(line({ phase: "copy", failing: { error: null } }), { onOpen, onRetry });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "cloud-move", label: "Try Garage server move again", title: "Your bots couldn't move to Garage server yet.", disabled: false, keepOpen: true });
    items[0]!.onSelect();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("failing: disabled with a spinner while Try again runs, and main's words when it did not answer", () => {
    const failing = line({ phase: "wait", failing: { error: "Garage server did not answer." } });
    const busy = rows(failing, { retrying: true });
    expect(busy[0]).toMatchObject({ disabled: true });
    expect(markup(busy[0]!.icon)).toContain("animate-spin");
    expect(rows(failing, { unanswered: "Openpals on this computer did not answer." })[0]!.title).toBe("Openpals on this computer did not answer.");
  });

  it("failing with no retry allowed: one row that opens the servers in Settings", () => {
    const onOpen = vi.fn(), onRetry = vi.fn();
    const items = rows({ kind: "failed", text: "Your bots couldn't move to Garage server yet.", extra: [], reason: "Garage server is full.", place }, { onOpen, onRetry });
    expect(items[0]).toMatchObject({ key: "cloud-move", label: "Garage server move needs you", title: "Garage server is full." });
    items[0]!.onSelect();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("on its way: one short row, the progress in its tooltip", () => {
    const items = rows(line({ phase: "copy", chats: { done: 3, total: 9 } }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: "Moving to Garage server…", title: "Moving your bots to Garage server… 3 of 9 chats" });
    expect(markup(items[0]!.icon)).toContain("animate-spin");
  });

  it("no move, no rows", () => {
    expect(rows(null)).toEqual([]);
  });
});

describe("useAccountMove", () => {
  it("says nothing without the move, nor in a browser", async () => {
    expect(await shown(notice)).toEqual({ kind: null, items: [] });
    f.values = [];
    vi.stubGlobal("window", {});
    expect(hook()).toEqual({ kind: null, items: [] });
    expect(lineHook()).toEqual({ kind: null, retry: null });
  });

  it("after a day of failing, Try again runs the move's own retry, with a spinner meanwhile", async () => {
    const failing = await shown({ ...notice, move: { phase: "copy", place, failing: { error: "Garage server did not answer." } } });
    expect(failing.kind).toBe("failed");
    let answer!: (value: CloudSendNotice) => void;
    page.moveRetry = vi.fn(() => new Promise<CloudSendNotice>((resolve) => { answer = resolve; }));
    failing.items[0]!.onSelect();
    expect(page.moveRetry).toHaveBeenCalledTimes(1);
    expect(hook().items[0]).toMatchObject({ disabled: true });
    expect(lineHook().retry).toMatchObject({ retrying: true });
    answer({ ...notice, move: { phase: "finishing", place } }); await flush();
    expect(hook()).toMatchObject({ kind: "sending", items: [{ label: "Moving to Garage server…" }] });
  });

  it("says main's words in the tooltip when Try again goes unanswered", async () => {
    const failing = await shown({ ...notice, move: { phase: "copy", place, failing: { error: "Garage server did not answer." } } });
    page.moveRetry = vi.fn().mockRejectedValue(new Error("Error invoking remote method 'cloud-send:move-retry': Error: Openpals on this computer did not answer."));
    failing.items[0]!.onSelect(); await flush();
    expect(hook().items[0]).toMatchObject({ title: "Openpals on this computer did not answer.", disabled: false });
  });

  it("the move's row opens the servers when it does not retry", async () => {
    (await shown({ ...notice, move: { phase: "copy", place, chats: { done: 1, total: 2 } } })).items[0]!.onSelect();
    expect(open).toHaveBeenCalledOnce();
  });
});
