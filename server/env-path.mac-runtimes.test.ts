import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { augmentedPath, resetPathCacheForTests } = await import("./env-path.ts");

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const real = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    resetPathCacheForTests();
    return run();
  } finally {
    Object.defineProperty(process, "platform", { value: real });
    resetPathCacheForTests();
  }
}

// A Finder-launched macOS app does not inherit the login-shell PATH.
describe("augmentedPath and the Docker CLI on macOS", () => {
  const dockerBin = join(homedir(), ".docker", "bin");

  afterEach(() => rmSync(join(homedir(), ".docker"), { recursive: true, force: true }));

  it("finds Docker Desktop's per-user bin dir", () => {
    mkdirSync(dockerBin, { recursive: true });
    const parts = withPlatform("darwin", () => augmentedPath().split(delimiter));
    expect(parts).toContain(dockerBin);
  });

  it("leaves Linux unchanged", () => {
    mkdirSync(dockerBin, { recursive: true });
    const parts = withPlatform("linux", () => augmentedPath().split(delimiter));
    expect(parts).not.toContain(dockerBin);
  });
});
