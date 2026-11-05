import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  phoneMenuItems,
  planUsageSummary,
  profileInitials,
  profileMenuItems,
  resetsIn,
  accountDot,
  accountLabel,
  toolMenuItems,
  type PlanUsageWindows,
  profileLabel,
} from "./SidebarProfileMenu";
import { APP_REPOSITORY, DOCS_URL, FEEDBACK_URL, HELP_CENTER_URL } from "@/lib/app-links";
import { profileForSession } from "@/lib/session";
import { connectPhoneEntry, type PhonePairingAccess, type PhonePairingTarget } from "@/lib/phone-pairing";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";
import { InitialsAvatar } from "./Avatar";

describe("profileInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(profileInitials({ name: "Milind Soni" })).toBe("MS");
    expect(profileInitials({ name: "Ada Byron Lovelace" })).toBe("AB");
  });

  it("falls back to the email, then to a placeholder", () => {
    expect(profileInitials({ email: "you@x.dev" })).toBe("Y");
    expect(profileInitials({})).toBe("?");
    expect(profileInitials(undefined)).toBe("?");
  });

  it("ignores whitespace-only names", () => {
    expect(profileInitials({ name: "   ", email: "you@x.dev" })).toBe("Y");
  });
});

describe("profileLabel", () => {
  it("prefers the name, then the email, then You", () => {
    expect(profileLabel({ name: "Omkar", email: "o@x.dev" })).toBe("Omkar");
    expect(profileLabel({ email: "o@x.dev" })).toBe("o@x.dev");
    expect(profileLabel(undefined)).toBe("You");
  });
});

describe("the sidebar profile for a signed-in visitor", () => {
  it("uses the fallback while the session identity is still loading", () => {
    const visible = profileForSession(
      { name: "Owner", email: "owner@example.test", avatarUrl: "/owner.png" },
      null,
    );
    expect(profileLabel(visible)).toBe("You");
    expect(profileInitials(visible)).toBe("?");
    expect(visible?.avatarUrl).toBeUndefined();
  });

  it("shows the verified email and initials without the configured owner's name or avatar", () => {
    const visible = profileForSession(
      { name: "Owner", email: "owner@example.test", avatarUrl: "/owner.png" },
      { kind: "session", id: "s", label: "Ada's iPad", email: "ada@example.test", scopes: ["client"], expiresAt: 1 },
    );
    expect(profileLabel(visible)).toBe("ada@example.test");
    expect(profileInitials(visible)).toBe("A");
    expect(visible?.avatarUrl).toBeUndefined();
  });
});

describe("outward links", () => {
  it("sends Help Center to the repository's docs and Send Feedback to its issues", () => {
    expect(APP_REPOSITORY).toBe("https://github.com/borjasolerme/Openpals");
    expect(HELP_CENTER_URL).toBe(DOCS_URL);
    expect(DOCS_URL).toBe("https://github.com/borjasolerme/Openpals/tree/main/docs");
    expect(FEEDBACK_URL).toBe("https://github.com/borjasolerme/Openpals/issues");
  });
});

describe("the phone entry", () => {
  const admin: PhonePairingAccess = { session: { kind: "session", id: "s", label: "Mac", scopes: ["admin", "client"], expiresAt: 1 }, pairingCodes: true };
  const chatOnly: PhonePairingAccess = { session: { kind: "session", id: "s", label: "Phone", scopes: ["client"], expiresAt: 1 }, pairingCodes: true };
  const items = (target: PhonePairingTarget, access: PhonePairingAccess | null, connected = false) => {
    const onConnect = vi.fn();
    return { list: phoneMenuItems({ entry: connectPhoneEntry(target, access), connected, onConnect }), onConnect };
  };
  const shown = (...args: Parameters<typeof items>) => items(...args).list.map((item) => [item.label, item.subtitle ?? null]);

  it("on this computer: Connect your phone, to this computer", () => {
    expect(shown("computer", null)).toEqual([["Connect your phone", "to this computer"]]);
  });

  it("on another server: to the bots here, and gone for a session that cannot make a pairing code", () => {
    expect(shown("server", admin)).toEqual([["Connect your phone", "to the bots here"]]);
    expect(shown("server", chatOnly)).toEqual([]);
    expect(shown("server", { ...admin, pairingCodes: false })).toEqual([]);
  });

  it("opens the phone pairing, and shows this computer's live phone on this computer's line only", () => {
    const { list, onConnect } = items("computer", null, true);
    list[0]!.onSelect();
    expect(onConnect).toHaveBeenCalledOnce();
    expect(list[0]!.trailing).toBeTruthy();
    expect(items("computer", null, false).list[0]!.trailing).toBeUndefined();
    expect(items("server", admin, true).list[0]!.trailing).toBeUndefined();
  });
});

describe("profileMenuItems", () => {
  const noop = () => {};
  const build = (patch: Partial<Parameters<typeof profileMenuItems>[0]> = {}) => profileMenuItems({
    phone: [{ key: "connect-phone", label: "Connect your phone", onSelect: noop }],
    onUsage: noop, onSettings: noop, onShortcuts: noop, onAbout: noop, onHelp: noop, onFeedback: noop,
    ...patch,
  });

  it("groups usage and the phone, then help and settings", () => {
    const items = build();
    expect(items.map((item) => item.key)).toEqual(["usage", "connect-phone", "support", "settings"]);
    expect(items.some((item) => item.separatorBefore)).toBe(false);
    expect(items.find((item) => item.key === "support")!.submenu!.map((item) => item.key)).toEqual(["help", "feedback", "shortcuts", "about"]);
  });


  it("opens the Usage page of Settings, and Send Feedback", () => {
    const onUsage = vi.fn(), onFeedback = vi.fn();
    const items = build({ onUsage, onFeedback });
    items.find((item) => item.key === "usage")!.onSelect();
    items.find((item) => item.key === "support")!.submenu!.find((item) => item.key === "feedback")!.onSelect();
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onFeedback).toHaveBeenCalledOnce();
  });
});

describe("Simple mode's account menu", () => {
  const noop = () => {};
  const tools = toolMenuItems({ activeView: "routines", automationsNeedYou: true, onAutomations: noop });
  const build = (patch: Partial<Parameters<typeof profileMenuItems>[0]> = {}) => profileMenuItems({
    phone: [{ key: "connect-phone", label: "Connect your phone", onSelect: noop }],
    simple: { tools },
    onUsage: noop, onSettings: noop, onShortcuts: noop, onAbout: noop, onHelp: noop, onFeedback: noop,
    ...patch,
  });
  const groups = (items: SidebarMenuItem[]) => items.reduce<string[][]>((all, item) => {
    if (item.separatorBefore || all.length === 0) all.push([]);
    all[all.length - 1]!.push(item.key);
    return all;
  }, []);

  it("leads with usage, the phone, support and Settings, then Automations", () => {
    expect(groups(build())).toEqual([
      ["usage", "connect-phone", "support", "settings"],
      ["automations"],
    ]);
  });

  it("gives the usage row a trailing meta and a chevron, with the reset as its second line", () => {
    const usage = build({ usageSummary: { value: "12% used", weekly: true, resets: "Resets in 3 days" } })[0]!;
    expect(usage).toMatchObject({ label: "Weekly usage", value: "12% used", subtitle: "Resets in 3 days", chevron: true });
    expect(build()[0]).toMatchObject({ label: "Usage", chevron: true });
    expect(build()[0]!.value).toBeUndefined();
  });

  it("keeps Advanced's account menu as it was", () => {
    const items = build({ simple: undefined, usageSummary: { value: "12% used" } });
    expect(items.map((item) => item.key)).toEqual(["usage", "connect-phone", "support", "settings"]);
    expect(items[0]!.chevron).toBeUndefined();
  });

  it("adds Archived bots while there are any, after Automations", () => {
    const open = vi.fn();
    const items = toolMenuItems({ activeView: "chat", automationsNeedYou: false, onAutomations: noop, archived: { count: 3, open } });
    expect(items.map((item) => [item.key, item.value])).toEqual([["automations", undefined], ["archived", "3"]]);
    items[1]!.onSelect();
    expect(open).toHaveBeenCalledOnce();
    expect(toolMenuItems({ activeView: "chat", automationsNeedYou: false, onAutomations: noop, archived: { count: 0, open } }).map((item) => item.key)).toEqual(["automations"]);
  });

  it("names the account button after the person and whatever its dot is raised for", () => {
    expect(accountLabel("You", { automationsNeedYou: false })).toBe("You");
    expect(accountLabel("Ada", { automationsNeedYou: true })).toBe("Ada · Automations need you");
  });

  it("raises the avatar's dot red while automations need the person", () => {
    expect(accountDot({ automationsNeedYou: false })).toBeNull();
    expect(accountDot({ automationsNeedYou: true })).toBe("danger");
  });


  it("draws a person instead of a question mark for someone with no name, at the trigger's own size", () => {
    const glyph = createElement("svg", { "data-glyph": "" });
    const nameless = renderToStaticMarkup(createElement(InitialsAvatar, { initials: profileInitials({}), size: 36, fallback: glyph, fontSize: 14 }));
    expect(nameless).toContain("data-glyph");
    expect(nameless).not.toContain("?");
    expect(nameless).toContain("font-size:14px");
  });

  it("marks Automations open and needing attention", () => {
    expect(tools.map((item) => [item.key, item.active, item.attention])).toEqual([["automations", true, true]]);
  });

});

describe("the usage meta", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const window = (usedPercent: number | null, resetsAt: string | null = null) => ({ available: usedPercent !== null, usedPercent, resetsAt });
  const provider = (patch: Partial<PlanUsageWindows["providers"][number]> = {}) => ({ ok: true, plan: null, weekly: window(null), fiveHour: window(null), ...patch });

  it("reads the tightest weekly window, then the 5-hour one, with when it resets", () => {
    const report = { providers: [provider({ weekly: window(12, "2026-10-30T12:00:00Z") }), provider({ weekly: window(31.6, "2026-10-28T12:00:00Z") }), provider({ ok: false, weekly: window(90) })] };
    expect(planUsageSummary(report, now)).toEqual({ value: "32% used", weekly: true, resets: "Resets tomorrow" });
    expect(planUsageSummary({ providers: [provider({ fiveHour: window(40, "2026-10-27T15:00:00Z") })] }, now)).toEqual({ value: "40% used", weekly: false, resets: "Resets in 3 hours" });
  });

  it("falls back to a plan's monthly budget when it has no rolling window", () => {
    const report = { providers: [provider({ extra: [{ label: "Monthly spend", usedPercent: 9.3 }, { label: "Other", usedPercent: 80 }] })] };
    expect(planUsageSummary(report, now)).toEqual({ value: "9% used" });
    expect(planUsageSummary({ providers: [provider({ extra: [{ label: "Other", usedPercent: 80 }] })] }, now)).toBeNull();
  });

  it("shows nothing without a percent, not even the plan's name", () => {
    expect(planUsageSummary({ providers: [provider({ plan: "Max" })] }, now)).toBeNull();
    expect(planUsageSummary({ providers: [provider()] }, now)).toBeNull();
    expect(planUsageSummary(null, now)).toBeNull();
  });

  it("says when a reset is days away, and nothing once it has passed", () => {
    expect(resetsIn(now + 3 * 86_400_000, now)).toBe("Resets in 3 days");
    expect(resetsIn(now - 1, now)).toBeUndefined();
    expect(resetsIn(null, now)).toBeUndefined();
  });
});
