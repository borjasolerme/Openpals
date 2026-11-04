import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), bots: [] as Bot[] }));
const scout: Bot = {
  id: "scout", threadId: "scout-main", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
  tasks: [
    { threadId: "scout-main", title: "Main", createdAt: 1 },
    { threadId: "qa-245", title: "QA PR 245", createdAt: 2, openedBy: { botId: "ada", name: "Ada", at: 2 } },
  ],
};
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: fixture.dispatch }) };
});
import { ThreadChip } from "./ThreadChip";

const receipt = (threadId = "qa-245"): Message => ({
  id: "receipt", role: "bot", kind: "activity", at: 3,
  tool: { name: "Opened thread #QA PR 245 on Scout", ok: true },
  threadRef: { botId: "scout", threadId, title: "QA PR 245" },
});

type ElementProps = { children?: ReactNode; onClick?: () => void; [key: string]: unknown };
function findElement(tree: ReactNode, attribute: string): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (attribute in child.props) return child;
    const found = findElement(child.props.children, attribute);
    if (found) return found;
  }
}

beforeEach(() => { fixture.dispatch.mockClear(); fixture.bots = [scout]; });

describe("ThreadChip", () => {
  it("renders the receipt as a pill that opens the teammate's chat", () => {
    const markup = renderToStaticMarkup(createElement(ThreadChip, { message: receipt() }));
    expect(markup).toContain("<button");
    expect(markup).toContain("Opened thread #QA PR 245 on Scout");
    expect(markup).toContain('title="Open the conversation with Scout"');
    expect(markup).toContain('data-thread-chip="qa-245"');
  });

  it("says in the person's words that work addressed into a room went to a bot outside it directly", () => {
    const sent = (sentDirectly: Message["sentDirectly"]) => renderToStaticMarkup(createElement(ThreadChip, {
      message: { ...receipt(), tool: { name: "server English", ok: true }, sentDirectly },
    }));
    expect(sent({ name: "Scout" })).toContain("Sent to Scout directly: it isn&#x27;t in this room.");
    expect(sent({ name: "Scout", room: "Sales" })).toContain("Sent to Scout directly: it isn&#x27;t in Sales.");
    expect(sent({ name: "Scout" })).not.toContain("server English");
  });

  it("renders nothing without a thread reference", () => {
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: { ...receipt(), threadRef: undefined } }))).toBe("");
  });

  it("clicking opens the teammate's one chat, never the thread its work runs in", () => {
    let tree: ReactNode;
    function Capture() { tree = ThreadChip({ message: receipt() }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-thread-chip")!.props.onClick!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: "select", id: "scout" }]);
  });

  it("opens the teammate at its main chat when it was left on another thread", () => {
    fixture.bots = [{ ...scout, threadId: "qa-245", mainThreadId: "scout-main" }];
    let tree: ReactNode;
    function Capture() { tree = ThreadChip({ message: receipt() }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-thread-chip")!.props.onClick!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: "switchTask", botId: "scout", threadId: "scout-main" }]);
  });

  it("is a still pill when the teammate is gone", () => {
    fixture.bots = [];
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: receipt() }))).toContain("disabled");
  });

  it("marks the receipt when the work in that thread failed", () => {
    const failed = renderToStaticMarkup(createElement(ThreadChip, {
      message: { ...receipt(), tool: { name: "Scout — cancelled: stopped by the person", ok: false } },
    }));
    expect(failed).toContain("Scout — cancelled: stopped by the person");
    expect(failed).toMatch(/<button[^>]*class="[^"]*text-danger/);
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: receipt() }))).not.toContain("text-danger");
  });
});
