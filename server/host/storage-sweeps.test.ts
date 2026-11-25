import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { engineSessionFolders } from "./engine-session-folders.ts";
import { engineEnvironments, startStorageSweeps, type StorageSweepsDeps } from "./storage-sweeps.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "storage-sweeps-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

function deps(env: NodeJS.ProcessEnv): StorageSweepsDeps {
  return {
    env, dataDir: join(root, "data"), bots: () => [], groups: () => [], instances: () => [], threadBusy: () => false,
    handedOff: () => false, paused: () => true, turnsRunning: () => false, logQuiet: () => true,
  };
}

describe("the storage sweeps", () => {
  it("start on every server unless their variables turn them off", () => {
    vi.useFakeTimers();
    try {
      expect(startStorageSweeps(deps({}))).toEqual({ threadLogs: true, toolResults: true, engineSessions: true });
      expect(startStorageSweeps(deps({ OMB_THREAD_LOG_SWEEP: "off", OMB_TOOL_RESULTS_SWEEP: "off", OMB_ENGINE_SESSION_SWEEP: "off" })))
        .toEqual({ threadLogs: false, toolResults: false, engineSessions: false });
      expect(startStorageSweeps(deps({ OMB_THREAD_LOG_SWEEP: "report", OMB_TOOL_RESULTS_SWEEP: "off" })))
        .toEqual({ threadLogs: true, toolResults: false, engineSessions: true });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("looks in each Claude account's own folder, never another engine's configDir, and in every ChatGPT plan's Codex home", () => {
    const home = join(root, "home");
    const dataDir = join(home, ".openmausbot");
    const account = join(dataDir, "providers", "claude-1");
    mkdirSync(join(dataDir, "providers", "chatgpt-plan", "abc"), { recursive: true });
    const environments = engineEnvironments({ HOME: home }, [
      { driver: "claudeAgent", config: { configDir: account } },
      { driver: "claudeAgent", config: { configDir: "~/work-claude" } },
      { driver: "codex", environment: { CODEX_HOME: join(home, "codex-home") } },
      { driver: "other", config: { configDir: join(home, "not-claude") } },
    ]);
    const folders = engineSessionFolders(dataDir, environments);
    expect([...folders.claude].sort()).toEqual([join(home, ".claude"), join(home, "work-claude"), account].sort());
    expect([...folders.codex].sort()).toEqual([join(home, ".codex"), join(home, "codex-home"), join(dataDir, "providers", "chatgpt-plan", "abc", "codex")].sort());
  });
});
