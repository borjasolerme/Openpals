import { describe, expect, it } from "vitest";

import { chiefChoices, chiefFor, chiefStepFits, createChiefPatch, defaultBotIn, INTRO_CHIPS, introChips, setupSteps } from "./default-bot";
import { partitionSidebarBots } from "./sidebar-layout";
import type { DefaultBotFields } from "../../shared/default-bot";

const bot = (id: string, fields: DefaultBotFields = {}): DefaultBotFields & { id: string } => ({ id, ...fields });

describe("MausBot in the sidebar", () => {
  it("leaves out a MausBot whose Show switch is off", () => {
    const bots = [bot("maus", { defaultBot: {} }), bot("writer")];
    const shown = () => partitionSidebarBots(bots).bots.map((entry) => entry.id);
    expect(shown()).toEqual(["maus", "writer"]);
    bots[0] = bot("maus", { defaultBot: {}, sidebarHidden: true });
    expect(shown()).toEqual(["writer"]);
  });
});

describe("MausBot's identity is its mark, never its name", () => {
  it("keeps finding a renamed MausBot for the Settings switch and the sidebar, and keeps it out of the list while its welcome is open", () => {
    const bots = [bot("writer"), { ...bot("maus", { defaultBot: {} }), name: "Jarvis" }];
    expect(defaultBotIn(bots)?.id).toBe("maus");
    expect(partitionSidebarBots(bots).bots.map((entry) => entry.id)).toEqual(["writer", "maus"]);
    expect(partitionSidebarBots(bots, { welcoming: "maus" }).bots.map((entry) => entry.id)).toEqual(["writer"]);
  });
});

describe("what MausBot offers to set up", () => {
  const fresh = { aiReady: false, ownBots: 0 };

  it("in Advanced mode, as on a new install before: an AI, bots, apps and the phone", () => {
    expect(setupSteps(fresh)).toEqual(["ai", "bots", "apps", "phone"]);
    expect(setupSteps({ ...fresh, aiReady: true })).toEqual(["bots", "apps", "phone"]);
    expect(setupSteps({ ...fresh, ownBots: 3 })).toEqual(["ai"]);
  });

  it("in Simple mode, chips for only what its look around found missing, in order: AI, apps, skills, phone", () => {
    expect(introChips(fresh)).toEqual(["ai", "apps", "phone"]);
    expect(introChips({ ...fresh, aiReady: true, importFound: true })).toEqual(["apps", "import", "phone"]);
    expect(introChips({ ...fresh, aiReady: true, appsConnected: true, phonePaired: true })).toEqual([]);
    expect(introChips({ ...fresh, aiReady: true, importFound: false })).toEqual(["apps", "phone"]);
    expect(INTRO_CHIPS).toBe(3);
  });

  it("never offers a bot (the sidebar's + adds one), nor nags a person who is set up", () => {
    expect(introChips(fresh)).not.toContain("bots");
    expect(introChips({ ...fresh, aiReady: true, ownBots: 3, importFound: true })).toEqual([]);
    expect(introChips({ ...fresh, ownBots: 3 })).toEqual(["ai"]);
  });
});

describe("the first run's Chief step", () => {
  const maus = { id: "maus", defaultBot: {}, chiefOfStaff: true };

  it("shows for a MausBot not yet introduced, where it is the Chief or there is none", () => {
    expect(chiefStepFits([maus], maus)).toBe(true);
    expect(chiefStepFits([{ ...maus, chiefOfStaff: false }], { ...maus, chiefOfStaff: false })).toBe(true);
  });

  it("is skipped where another bot is the Chief, once MausBot has met the person, and with no MausBot", () => {
    const other = { ...maus, chiefOfStaff: false };
    expect(chiefStepFits([other, { id: "research", chiefOfStaff: true }], other)).toBe(false);
    expect(chiefStepFits([{ ...maus, welcomed: true }], { ...maus, welcomed: true })).toBe(false);
    expect(chiefStepFits([{ id: "research" }], undefined)).toBe(false);
  });

  it("keeps a Chief in another department out of it", () => {
    const other = { ...maus, chiefOfStaff: false };
    expect(chiefStepFits([other, { id: "sales", chiefOfStaff: true, section: "Sales" }], other)).toBe(true);
  });
});

describe("who becomes the Chief of Staff on the first run", () => {
  type Candidate = { id: string; defaultBot?: DefaultBotFields["defaultBot"]; chiefOfStaff?: boolean; section?: string; hidden?: boolean; sidebarHidden?: boolean };
  const maus: Candidate = { id: "maus", defaultBot: {}, chiefOfStaff: true };
  const research: Candidate = { id: "research" };

  it("finds the Chief in MausBot's own department, never a department's or a hidden one", () => {
    expect(chiefFor([maus, research], maus)?.id).toBe("maus");
    expect(chiefFor([{ ...maus, chiefOfStaff: false }, { ...research, chiefOfStaff: true }], maus)?.id).toBe("research");
    expect(chiefFor([{ ...maus, chiefOfStaff: false }, { id: "sales", section: "Sales", chiefOfStaff: true }], maus)).toBeUndefined();
    expect(chiefFor([{ ...maus, chiefOfStaff: false }, { id: "old", chiefOfStaff: true, hidden: true }], maus)).toBeUndefined();
  });

  it("offers the bots there to choose from, never MausBot, a hidden bot or one left out of the sidebar", () => {
    const bots: Candidate[] = [maus, research, { id: "sales", section: "Sales" }, { id: "gone", hidden: true }, { id: "tucked", sidebarHidden: true }];
    expect(chiefChoices(bots, maus).map((bot) => bot.id)).toEqual(["research"]);
    expect(chiefChoices([maus], maus)).toEqual([]);
  });

  it("Create makes MausBot the Chief only where there is none, and never takes the role from a Chief someone has", () => {
    expect(createChiefPatch({ defaultBot: {} }, undefined)).toEqual({ welcomed: true, chiefOfStaff: true });
    expect(createChiefPatch({ defaultBot: {} }, maus)).toEqual({ welcomed: true });
    expect(createChiefPatch({ defaultBot: {}, sidebarHidden: true }, maus), "back in the sidebar").toEqual({ welcomed: true, sidebarHidden: false });
  });
});
