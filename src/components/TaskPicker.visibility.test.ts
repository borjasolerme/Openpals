import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Group } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [], pendingQueued: {} }, dispatch: vi.fn() }),
}));

const { GroupTaskPicker } = await import("./TaskPicker");

describe("room thread picker", () => {
  it("keeps a channel's history controls", () => {
    const group: Group = { id: "team", name: "Team", threadId: "team-current", memberIds: [], defaultResponder: { kind: "everyone" }, bulletin: "", createdAt: 1, unread: false, messages: [],
      tasks: [{ threadId: "team-current", title: "Channel discussion", createdAt: 1 }] };
    expect(renderToStaticMarkup(createElement(GroupTaskPicker, { group }))).toContain('aria-label="All threads"');
  });
});
