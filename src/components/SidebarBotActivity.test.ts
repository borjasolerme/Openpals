import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, Task } from "@/state/store";
import { botShowsUnread } from "@/lib/bot-unread";
import { SidebarBotActivity } from "./SidebarBotActivity";

const task = (threadId: string, title: string, extra: Partial<Task>): Task =>
  ({ threadId, title, createdAt: 0, ...extra }) as Task;
const bot = (id: string, name: string, threadId: string, tasks?: Task[], extra: Partial<Bot> = {}): Bot =>
  ({ id, name, threadId, tasks, ...extra }) as unknown as Bot;

describe("botShowsUnread", () => {
  it("keeps the bot flag when there is no task list", () => {
    expect(botShowsUnread(bot("s", "Solo", "s0", undefined, { unread: true }))).toBe(true);
    expect(botShowsUnread(bot("s", "Solo", "s0", undefined))).toBe(false);
    expect(botShowsUnread(bot("s", "Solo", "s0", [], { unread: true }))).toBe(true);
  });

  it("ignores a hidden routine execution and counts a visible unread thread", () => {
    const hiddenOnly = bot("r", "Runner", "r0", [
      task("r0", "Read chat", {}),
      task("r1", "Failed run", { routineRunId: "run-1", unread: true }),
    ], { unread: true });
    expect(botShowsUnread(hiddenOnly)).toBe(false);
    const visible = bot("p", "Plain", "p0", [
      task("p0", "Unread chat", { unread: true }),
      task("p1", "Failed run", { routineRunId: "run-1", unread: true }),
    ]);
    expect(botShowsUnread(visible)).toBe(true);
  });

  it("ignores an archived thread's unread reply", () => {
    const archived = bot("p", "Plain", "p0", [
      task("p0", "Read chat", {}),
      task("p1", "Put away", { archivedAt: 5, unread: true }),
    ], { unread: true });
    expect(botShowsUnread(archived)).toBe(false);
  });
});

describe("needs-you rows under a bot", () => {
  const ivy = bot("ivy", "Ivy", "i0", [
    task("i0", "Main chat", {}),
    task("i1", "Opened by the Chief, ended on a card", { unread: true, openedBy: { botId: "chief", name: "Chief", at: 1 } }),
    task("i2", "Needs approval", { busy: true, activity: "waiting-on-you" }),
    task("i3", "Still running", { busy: true, activity: "working" }),
    task("i4", "Waits on a teammate", { waitingForTeammates: true }),
    task("i5", "Morning brief run", { routineRunId: "run-1", activity: "waiting-on-you" }),
  ]);
  const render = (owner: Bot, rowThreadId = "i0", dispatch = vi.fn()) =>
    SidebarBotActivity({ bot: owner, rowThreadId, density: "comfortable", dispatch });

  it("lists only threads that wait on the person, a routine run's too", () => {
    const markup = renderToStaticMarkup(createElement(SidebarBotActivity, { bot: ivy, rowThreadId: "i0", density: "comfortable", dispatch: vi.fn() }));
    expect(markup).toContain('data-sidebar-activity-row="i2"');
    expect(markup).toContain('data-sidebar-activity-row="i5"');
    expect(markup).toContain('aria-label="Ivy: Needs approval · Waiting for you…"');
    for (const quiet of ["i0", "i1", "i3", "i4"]) expect(markup).not.toContain(`data-sidebar-activity-row="${quiet}"`);
  });

  it("leaves out the thread the bot's row already opens, and renders nothing when nothing waits", () => {
    expect(renderToStaticMarkup(createElement(SidebarBotActivity, { bot: ivy, rowThreadId: "i2", density: "comfortable", dispatch: vi.fn() }))).not.toContain('data-sidebar-activity-row="i2"');
    expect(render(bot("q", "Quiet", "q0", [task("q0", "Read", {}), task("q1", "Running", { busy: true, activity: "working" })]))).toBeNull();
  });

  it("opens the waiting thread, where its card is", () => {
    const dispatch = vi.fn();
    const rows = (render(ivy, "i0", dispatch) as ReactElement<{ children: ReactNode }>).props.children as ReactElement<{ onClick: () => void }>[];
    const approval = rows.find((row) => isValidElement(row) && row.key === "i2")!;
    approval.props.onClick();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "switchTask", botId: "ivy", threadId: "i2" });
  });
});
