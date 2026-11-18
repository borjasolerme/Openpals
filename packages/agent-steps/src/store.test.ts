import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestKey } from "./key.ts";
import { FileStore, UNUSED_MS } from "./store.ts";
import type { Recipe, Step } from "./types.ts";

const NOTES = { name: "Notes" };
const recipe = (id: string, name: string, lastUsedAt = 1_000, steps: Step[] = [{ driver: "cua", tool: "launch_app", args: { name: "Notes" } }]): Recipe => ({
  version: 2, id, name, key: requestKey(name), request: name, revision: 1, inputs: [], steps, checks: [], createdAt: 1_000, updatedAt: 1_000, lastUsedAt,
});

describe("FileStore", () => {
  let dir: string;
  let clock: number;
  let store: FileStore;
  const write = (id: string, value: unknown) => writeFileSync(join(dir, `${id}.json`), JSON.stringify(value));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-steps-store-"));
    clock = 5_000;
    store = new FileStore({ folder: dir, now: () => clock, maxRecipes: 3 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps one 0600 JSON file per recipe and finds it by key or id", () => {
    store.save(recipe("r1", "Open Notes"));
    expect(store.find("open notes")?.id).toBe("r1");
    expect(store.get("r1")?.name).toBe("Open Notes");
    expect(store.find("other")).toBeUndefined();
    expect(readdirSync(dir)).toEqual(["r1.json"]);
    if (process.platform !== "win32") expect(statSync(join(dir, "r1.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dir, "r1.json"), "utf8"))).toMatchObject({ version: 2, id: "r1", revision: 1 });
  });

  it("replaces the recipe for the same key, and keeps the most recently used up to the limit", () => {
    store.save(recipe("r1", "Open Notes"));
    store.save(recipe("r2", "open notes!", 2_000));
    expect(store.list().map((entry) => entry.id)).toEqual(["r2"]);
    for (const [index, name] of ["a", "b", "c"].entries()) store.save(recipe(`k${index}`, `open ${name}`, 3_000 + index));
    expect(store.list().map((entry) => entry.id)).toEqual(["k2", "k1", "k0"]);
    expect(readdirSync(dir).sort()).toEqual(["k0.json", "k1.json", "k2.json"]);
  });

  it("drops a recipe unused too long, and touch keeps one in use", () => {
    store.save(recipe("r1", "open notes", 1_000));
    clock = 1_000 + UNUSED_MS - 1;
    store.touch("r1");
    clock += UNUSED_MS - 1;
    expect(store.find("open notes")?.lastUsedAt).toBe(1_000 + UNUSED_MS - 1);
    clock += 2;
    expect(store.find("open notes")).toBeUndefined();
  });

  it("forget answers whether it removed something", () => {
    store.save(recipe("r1", "open notes"));
    expect(store.forget("r1")).toBe(true);
    expect(store.forget("r1")).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses an id that is not a plain file name, and a recipe its policy refuses", () => {
    expect(() => store.save(recipe("../r1", "open notes"))).toThrow(/recipe id/);
    expect(() => store.save(recipe("r1", "open notes", 1_000, [{ driver: "cua", tool: "set_value", args: { value: "hello" }, app: NOTES, window: { title: "Notes" },
      element: { role: "AXTextArea", label: "Body", path: [] } }]))).toThrow(/policy/);
  });

  it.each<[string, Step]>([
    ["addressing in a step's arguments", { driver: "cua", tool: "click", args: { element_token: "s1-e2" }, app: NOTES, window: { title: "Notes" }, element: { role: "AXButton", label: "New", path: [] } }],
    ["a pixel position", { driver: "cua", tool: "click", args: { x: 1, y: 2 }, app: NOTES, window: { title: "Notes" }, element: { role: "AXButton", label: "New", path: [] } }],
    ["an element step without its element", { driver: "cua", tool: "click", args: {}, app: NOTES }],
    ["a click that flips a toggle", { driver: "cua", tool: "click", args: {}, app: NOTES, window: { title: "Notes" }, element: { role: "AXCheckBox", label: "Bold", path: [] } }],
    ["a click on a final action", { driver: "cua", tool: "click", args: {}, app: NOTES, window: { title: "Notes" }, element: { role: "AXButton", label: "Delete", path: [] } }],
    ["a web click on a final action", { driver: "agent-browser", tool: "click", args: {}, target: { role: "button", name: "Send" } }],
    ["typing into a web password field", { driver: "agent-browser", tool: "fill", args: { text: "open notes" }, target: { role: "textbox", name: "Password" } }],
    ["a web click without its target", { driver: "agent-browser", tool: "click", args: {} }],
    ["a web tool it does not know", { driver: "agent-browser", tool: "eval" as never, args: { script: "1" } }],
  ])("skips a file holding %s and keeps the rest", (_case, step) => {
    store.save(recipe("good", "open notes"));
    write("bad", recipe("bad", "open bad", 4_000, [step]));
    expect(store.list().map((entry) => entry.id)).toEqual(["good"]);
  });

  it("skips malformed files, a key that is not its name's, and a file whose id is not its name", () => {
    write("junk", { version: 1, recipes: [] });
    write("key", { ...recipe("key", "open notes"), key: "something else" });
    write("other", recipe("not-other", "open notes"));
    writeFileSync(join(dir, "broken.json"), "{");
    expect(store.list()).toEqual([]);
  });

  it("under the strict policy, skips typing words the recipe's own request does not hold", () => {
    const typed = (value: string): Step => ({ driver: "agent-browser", tool: "fill", args: { text: value }, target: { role: "searchbox", name: "Search" } });
    write("ok", recipe("ok", "search for cats", 1_000, [typed("cats")]));
    write("no", recipe("no", "search for dogs", 1_000, [typed("cats")]));
    expect(store.list().map((entry) => entry.id)).toEqual(["ok"]);
    expect(new FileStore({ folder: dir, now: () => clock, policy: "standard" }).list().map((entry) => entry.id).sort()).toEqual(["no", "ok"]);
  });
});
