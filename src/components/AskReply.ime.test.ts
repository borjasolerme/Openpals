// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskReply } from "./AskCard";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

function press(field: HTMLTextAreaElement, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
  flushSync(() => field.dispatchEvent(event));
  return event;
}

const IME = [
  { name: "composition", init: { isComposing: true } },
  { name: "IME key code", init: { keyCode: 229 } },
];

describe("answering a bot's question with an input method", () => {
  function renderReply() {
    const onSend = vi.fn();
    flushSync(() => root.render(createElement(AskReply, { label: "Answer", placeholder: "Answer", color: undefined, onSend, value: "ni hao", onChange: () => {} })));
    return { field: host.querySelector("textarea")!, onSend };
  }

  it.each(IME)("AskReply leaves the Enter that belongs to the $name to the input method", ({ init }) => {
    const { field, onSend } = renderReply();
    const event = press(field, init);
    expect(event.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("AskReply still sends on a plain Enter", () => {
    const { field, onSend } = renderReply();
    press(field);
    expect(onSend).toHaveBeenCalledWith("ni hao");
  });
});
