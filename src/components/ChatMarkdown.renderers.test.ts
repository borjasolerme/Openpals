import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("react-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-markdown")>();
  return { ...actual, default: (props: Record<string, unknown>) => { captured.push(props); return null; } };
});
// react-markdown is stubbed above, so every parse counted here is one of ChatMarkdown's own passes.
vi.mock("mdast-util-from-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mdast-util-from-markdown")>();
  return { ...actual, fromMarkdown: vi.fn(actual.fromMarkdown) };
});

import { fromMarkdown } from "mdast-util-from-markdown";
import { ChatMarkdown, clearChatMarkdownCache } from "./ChatMarkdown";

function markdownProps(text: string): Record<string, unknown> {
  clearChatMarkdownCache();
  captured.length = 0;
  renderToStaticMarkup(createElement(ChatMarkdown, { text, message: { threadId: "t", messageId: "m" } }));
  expect(captured).toHaveLength(1);
  return captured[0]!;
}

describe("ChatMarkdown element renderers", () => {
  it("hands react-markdown the same renderers for every message", () => {
    const first = markdownProps("Tracked in #QA PR 245.\n\n```ts\nconst kept = true;\n```");
    expect(markdownProps("Another message").components).toBe(first.components);
  });
});

describe("ChatMarkdown normalization", () => {
  beforeEach(() => vi.mocked(fromMarkdown).mockClear());

  it("parses a message for table repair and math once, however often it renders", () => {
    const text = "## Costs\n\n| Step | Cost |\n|---|\n| build | 5 |\n\nArea \\(x^2\\).";
    const first = markdownProps(text);
    expect(first.children).toContain("$x^2$");
    expect(fromMarkdown).toHaveBeenCalledTimes(2);

    const second = markdownProps(text);
    expect(second.children).toBe(first.children);
    expect(fromMarkdown).toHaveBeenCalledTimes(2);
  });

  it("remembers a bounded number of messages, newest kept", () => {
    const oldest = "The oldest message.";
    markdownProps(oldest);
    for (let i = 0; i < 1000; i++) markdownProps(`Message ${i}.`);

    vi.mocked(fromMarkdown).mockClear();
    markdownProps("Message 999.");
    expect(fromMarkdown).not.toHaveBeenCalled();
    markdownProps(oldest);
    expect(fromMarkdown).toHaveBeenCalledOnce();
  });
});

describe("ChatMarkdown rendered once per message", () => {
  const draw = (text: string, extra: Record<string, unknown> = {}) => {
    renderToStaticMarkup(createElement(ChatMarkdown, { text, message: { threadId: "t", messageId: "m" }, ...extra }));
  };
  const parses = (run: () => void) => {
    captured.length = 0;
    run();
    return captured.length;
  };
  beforeEach(() => clearChatMarkdownCache());

  it("draws a message again from its first rendering", () => {
    const text = "## Plan\n\n- one\n- two with `code`";
    expect(parses(() => draw(text))).toBe(1);
    expect(parses(() => { draw(text); draw(text); })).toBe(0);
    expect(parses(() => draw(`${text}\n- three`))).toBe(1);
  });

  it("renders a message again only when what its plugins read changes", () => {
    const plain = "No names in this one.";
    const named = "Ask @Atlas about it.";
    expect(parses(() => { draw(plain, { mentionPeers: [{ name: "Atlas" }] }); draw(named, { mentionPeers: [{ name: "Atlas" }] }); })).toBe(2);
    // A new peer list with the same names is the same rendering; a renamed or recoloured peer is not.
    expect(parses(() => { draw(plain, { mentionPeers: [{ name: "Juno" }] }); draw(named, { mentionPeers: [{ name: "Atlas" }] }); })).toBe(0);
    expect(parses(() => draw(named, { mentionPeers: [{ name: "Atlas", color: "red" }] }))).toBe(1);
    expect(parses(() => draw(named, { mentionPeers: [{ name: "Atlas", color: "red" }], everyone: true }))).toBe(1);
  });
});
