import { describe, expect, it, vi } from "vitest";
import { reloadOnceForChunk } from "./PageBoundary";

const store = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
};
const missing = new Error("Failed to fetch dynamically imported module: https://example.test/assets/App-abc.js");

describe("reloadOnceForChunk", () => {
  it("reloads once by itself when a piece of the app could not be downloaded, and not again within a minute", () => {
    const storage = store();
    const reload = vi.fn();
    expect(reloadOnceForChunk(missing, 1_000_000, storage, reload)).toBe(true);
    expect(reloadOnceForChunk(missing, 1_030_000, storage, reload)).toBe(false);
    expect(reloadOnceForChunk(missing, 1_070_000, storage, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("leaves any other error to the page and its Reload button", () => {
    const reload = vi.fn();
    expect(reloadOnceForChunk(new Error("Cannot read properties of undefined"), 1, store(), reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
