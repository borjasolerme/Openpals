import { describe, expect, it } from "vitest";
import { createComputerFrames } from "../computer-frames.ts";
import { createComputerFramesRoutes, frameForCaller, mapComputers, parseHave } from "./computer-frames.ts";
import { PASS } from "./table.ts";

const bots = [
  { id: "ada", name: "Ada", computer: "cloud" as const },
  { id: "ben", name: "Ben" },
  { id: "cy", name: "Cy" },
  { id: "dee", name: "Dee", computer: "cloud" as const, cloudBackend: "vps" as const },
  { id: "eve", name: "Eve", computer: "cloud" as const, hidden: true },
  { id: "fay", name: "Fay" },
  { id: "gus", name: "Gus", computer: "off" as const },
];

describe("map computers", () => {
  it("draws each bot's own cloud computer", () => {
    const machines = new Map([["gus", { owner: "gus", boxId: "bx_g", state: "archived" }]]);
    const nodes = mapComputers({ bots, machine: (owner) => machines.get(owner), working: () => false });
    expect(nodes).toEqual([
      { id: "ada", name: "Ada", botIds: ["ada"], state: "off" },
      { id: "gus", name: "Gus", botIds: ["gus"], state: "asleep" },
    ]);
  });

  it("reads the have list and sends a turn frame only to a caller without any frame", () => {
    expect([...parseHave("ada:map-5,computer_x:turn-9,bad")]).toEqual([["ada", "map-5"], ["computer_x", "turn-9"]]);
    const turn = { data: "big", mime: "image/jpeg", at: 9, source: "turn" as const, version: "turn-9" };
    const map = { data: "small", mime: "image/jpeg", at: 10, source: "map" as const, version: "map-10" };
    expect(frameForCaller(turn, undefined).data).toBe("big");
    expect(frameForCaller(turn, "map-3").data).toBeUndefined();
    expect(frameForCaller(map, "turn-9").data).toBe("small");
    expect(frameForCaller(map, "map-10").data).toBeUndefined();
  });
});

describe("GET /api/computers/frames", () => {
  const request = async (handler: ReturnType<typeof createComputerFramesRoutes>, path = "/api/computers/frames", have = "") => {
    let body: any;
    const res = { setHeader: () => {} } as any;
    const out = await handler({
      res, url: new URL(`http://127.0.0.1${path}?have=${encodeURIComponent(have)}`), path, method: "GET",
      json: ((_res: unknown, _status: number, value: unknown) => { body = value; }) as any,
    } as any);
    return { out, body };
  };

  it("lists computers without asking the provider when no Boat account is connected", async () => {
    let lists = 0;
    const frames = createComputerFrames({
      listMachines: async () => { lists += 1; return []; },
      capture: async () => ({ data: "", mime: "image/jpeg" }), turnFrame: () => undefined,
      working: () => false, held: () => false, tickMs: 1e9,
    });
    const handler = createComputerFramesRoutes({
      cfg: {} as any, store: { bots } as any,
      computerControl: { snapshot: () => ({ held: false }) } as any, computerProviderConfigTransitions: new Set(),
      managedBoatOwners: () => [], botHasActiveTurn: () => false,
    }, frames);
    expect((await request(handler, "/api/other")).out).toBe(PASS);
    const { body } = await request(handler);
    expect(body.configured).toBe(false);
    expect(body.computers.map((computer: { id: string }) => computer.id)).toEqual(["ada"]);
    expect(lists).toBe(0);
    expect(frames.watching()).toBe(false);
  });
});
