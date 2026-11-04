import { describe, expect, it, vi } from "vitest";

describe("RoutineScheduleNote", () => {
  it("says a routine on this computer runs while the app is open, and on a server while it runs", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    for (const [local, kind] of [[true, "local"], [false, "server"]] as const) {
      vi.resetModules();
      vi.stubGlobal("window", { ogb: {} });
      vi.doMock("./onboarding/WelcomeGate", () => ({ localDesktopPage: () => local }));
      const { RoutineScheduleNote } = await import("./RoutineScheduleNote");
      expect(renderToStaticMarkup(createElement(RoutineScheduleNote))).toContain(`data-routine-schedule-note="${kind}"`);
      vi.doUnmock("./onboarding/WelcomeGate");
      vi.unstubAllGlobals();
    }
  });
});
