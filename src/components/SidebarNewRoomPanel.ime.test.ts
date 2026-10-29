// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: fixture.api,
    useStore: () => ({ state: { ...original.initialState, bots: [bot] }, dispatch: fixture.dispatch }),
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { NewRoomPanel } from "./SidebarNewRoomPanel";

const bot: Bot = {
  id: "ime-bot", threadId: "ime-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "claude", model: "fake" },
};

const composing = [
  { name: "composition", init: { isComposing: true } },
  { name: "IME key code", init: { keyCode: 229 } },
];

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
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  flushSync(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  flushSync(() => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
}

describe("New channel panel with an input method", () => {
  function open() {
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(NewRoomPanel, { onClose })));
    flushSync(() => document.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="Atlas"]')!.click());
    const [name] = [...document.querySelectorAll<HTMLInputElement>("input")];
    return { onClose, name: name! };
  }

  it.each(composing)("does not create the channel or close on keys that belong to the $name", ({ init }) => {
    const { onClose, name } = open();
    type(name, "kaifa");
    press(name, "Enter", init);
    press(name, "Escape", init);
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("creates the channel on the Enter after the text is committed", () => {
    const { onClose, name } = open();
    type(name, "开发");
    press(name, "Enter");
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "createGroup", name: "开发", memberIds: [bot.id] }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
