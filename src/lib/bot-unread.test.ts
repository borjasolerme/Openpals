import { afterEach, describe, expect, it, vi } from "vitest";

import { botShowsUnread, showBrowserUnread, titleWithUnread } from "./bot-unread";

describe("whether a bot shows unread", () => {
  it("shows unread while the bot's chat is, and nothing once read", () => {
    expect(botShowsUnread({ threadId: "chat", tasks: [{ threadId: "chat", unread: true }] })).toBe(true);
    expect(botShowsUnread({ unread: true })).toBe(true);
    expect(botShowsUnread({ threadId: "chat", tasks: [{ threadId: "chat", unread: false }] })).toBe(false);
  });

  it("ignores background conversations the person cannot open, so a read chat never keeps the dot", () => {
    expect(botShowsUnread({ threadId: "chat", mainThreadId: "chat", tasks: [{ threadId: "chat", unread: false }, { threadId: "side", unread: true }] })).toBe(false);
  });
});

describe("browser unread indicator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefixes the title with the count, replaces an older count, and drops it at zero", () => {
    expect(titleWithUnread("Openpals", 3)).toBe("(3) Openpals");
    expect(titleWithUnread("(3) Openpals", 5)).toBe("(5) Openpals");
    expect(titleWithUnread("(5) Acme", 0)).toBe("Acme");
    expect(titleWithUnread("Acme", 0)).toBe("Acme");
  });

  it("sets the title and the app badge, and clears both", () => {
    const doc = { title: "Openpals" };
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });

    showBrowserUnread(2);
    expect(doc.title).toBe("(2) Openpals");
    expect(setAppBadge).toHaveBeenCalledWith(2);

    showBrowserUnread(0);
    expect(doc.title).toBe("Openpals");
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it("keeps the page's own title, such as a white-label name or a preview page's", () => {
    const doc = { title: "Isolated OpenMaus Chat" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", {});
    showBrowserUnread(0);
    expect(doc.title).toBe("Isolated OpenMaus Chat");
    showBrowserUnread(1);
    expect(doc.title).toBe("(1) Isolated OpenMaus Chat");
  });

  it("still sets the title where the Badging API is missing or refuses", () => {
    const doc = { title: "Openpals" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", {});
    showBrowserUnread(1);
    expect(doc.title).toBe("(1) Openpals");

    vi.stubGlobal("navigator", { setAppBadge: () => Promise.reject(new Error("NotAllowedError")) });
    showBrowserUnread(4);
    expect(doc.title).toBe("(4) Openpals");
  });
});
