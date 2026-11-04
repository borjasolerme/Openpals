import { describe, expect, it, vi } from "vitest";
import type { Bot, BotAnnouncement } from "@/state/store";
import { departmentUnread, markDepartmentRead } from "./mark-read";

const bot: Bot = {
  id: "maus", threadId: "main", name: "Maus", title: "", description: "", notifications: true,
  color: "green", unread: true, messages: [], modelSelection: { instanceId: "fake", model: "test" },
};

describe("mark a department as read", () => {
  const member = (id: string, section: string | undefined, unread: boolean, extra: Partial<Bot> = {}): Bot => ({
    ...bot, id, threadId: `${id}-main`, section, unread,
    tasks: [{ threadId: `${id}-main`, title: "Main", createdAt: 0, unread }, { threadId: `${id}-side`, title: "Side", createdAt: 1, unread }],
    ...extra,
  });
  const bots = [member("ada", "Ops", true), member("ben", "Ops", false), member("cara", "Sales", true), member("dan", "Ops", true, { hidden: true }), member("eve", " Ops ", true)];
  const groups = [
    { id: "standup", unread: true, section: "Ops" }, { id: "quiet", unread: false, section: "Ops" },
    { id: "dm", unread: true, section: "Ops", dm: true }, { id: "deals", unread: true, section: "Sales" },
  ];

  it("covers the department's shown bots with unread conversations and its unread group chats, nothing else", () => {
    const unread = departmentUnread("Ops", bots, groups);
    expect(unread.bots.map((b) => b.id)).toEqual(["ada", "eve"]);
    expect(unread.groups.map((g) => g.id)).toEqual(["standup"]);
    expect(departmentUnread("Nowhere", bots, groups)).toEqual({ bots: [], groups: [] });
  });

  it("reads every conversation of each bot, then each group chat, one request at a time", async () => {
    const calls: string[] = [];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push(`${path} ${init?.body ?? ""}`.trim());
      return path.startsWith("/api/groups/") ? { group: { id: "standup", unread: false } } : { bot: { id: "ada" } as BotAnnouncement };
    });
    const read = { bots: [] as string[], groups: [] as string[] };
    await markDepartmentRead(departmentUnread("Ops", bots, groups), request, (b) => read.bots.push(b.id), (g) => read.groups.push(g.id));
    expect(calls).toEqual([
      '/api/bots/ada/read {"threadId":"ada-main"}', '/api/bots/ada/read {"threadId":"ada-side"}',
      '/api/bots/eve/read {"threadId":"eve-main"}', '/api/bots/eve/read {"threadId":"eve-side"}',
      "/api/groups/standup/read",
    ]);
    expect(read.groups).toEqual(["standup"]);
  });

  it("keeps the reads before a failure and reports it", async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes("eve")) throw new Error("offline");
      return { bot: { id: "ada" } as BotAnnouncement };
    });
    await expect(markDepartmentRead(departmentUnread("Ops", bots, groups), request, () => {}, () => {})).rejects.toThrow("offline");
    expect(request.mock.calls.map(([path]) => path)).toEqual(["/api/bots/ada/read", "/api/bots/ada/read", "/api/bots/eve/read"]);
  });
});

