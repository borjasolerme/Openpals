import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import type { Backend } from "./backends.ts";
import { CdpBrowser } from "./cdp/browser.ts";
import { BrowserService } from "./service.ts";
import { FakeBackend, FakeChrome } from "./testing/fake-chrome.ts";

const fixtures: Array<{ service: BrowserService; dataDir: string }> = [];
afterEach(async () => {
  for (const { service, dataDir } of fixtures.splice(0)) {
    try { await service.closeAll(); } finally { await removeTempDir(dataDir); }
  }
});

function setup(key = "bot:fixture") {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-browser-downloads-"));
  const backend: Backend = {
    kind: "local",
    caps: new FakeBackend().caps,
    async open(request) {
      const wire = new FakeChrome();
      const browser = await CdpBrowser.connect(wire, { downloadDir: request.downloadDir });
      const exited = new Promise<void>((resolve) => wire.onClose(() => resolve()));
      return { browser, pid: null, version: "153.0.0.0", exited, close: () => browser.close() };
    },
  };
  const service = new BrowserService({ dataDir, backend: () => backend, maxRunning: 1, idleMs: () => 1_000 });
  fixtures.push({ service, dataDir });
  const target = { key, session: "bot-fixture" };
  const profile = service.profile(target);
  const download = async () => {
    const run = await service.running(profile);
    writeFileSync(join(profile.downloadDir, "fixture-guid"), "fixture download");
    run.browser.connection.root.emit("Browser.downloadWillBegin", { guid: "fixture-guid", suggestedFilename: "report.txt" });
    run.browser.connection.root.emit("Browser.downloadProgress", { guid: "fixture-guid", state: "completed", receivedBytes: 16 });
    const file = run.browser.downloads!.list()[0]!;
    expect(service.download(target.session, file.id)?.path).toBe(file.path);
    expect(existsSync(file.path!)).toBe(true);
    writeFileSync(join(profile.downloadDir, "partial.crdownload"), "partial");
    return { run, file };
  };
  return { service, target, profile, download };
}

describe("browser download lifetime", () => {
  it("removes completed and partial files with their index across three idle cycles", async () => {
    const { service, target, profile, download } = setup();
    for (let cycle = 0; cycle < 3; cycle++) {
      const { file } = await download();
      expect(await service.closeUnused(target.session)).toBe(true);
      expect(service.download(target.session, file.id)).toBeUndefined();
      expect(existsSync(profile.downloadDir)).toBe(false);
      const next = await service.running(profile);
      expect(next.browser.downloads!.list()).toEqual([]);
      expect(readdirSync(profile.downloadDir)).toEqual([]);
    }
  });

  it.each(["close", "closeAll", "restart", "erase", "temporary", "capacity"] as const)("removes files when the browser ends by %s", async (stop) => {
    const { service, target, profile, download } = setup(stop === "temporary" ? "temp:fixture" : undefined);
    const { file } = await download();
    if (stop === "closeAll") await service.closeAll();
    else if (stop === "restart") await service.restart(target.session, "local-owner");
    else if (stop === "erase") await service.erase(target.key);
    else if (stop === "capacity") await service.running(service.profile({ key: "bot:other", session: "bot-other" }));
    else await service.close(target.session);
    expect(service.download(target.session, file.id)).toBeUndefined();
    expect(existsSync(profile.downloadDir)).toBe(false);
    expect(profile.control.closing).toBe(false);
  });

  it("removes files when Chrome exits unexpectedly", async () => {
    const { service, target, profile, download } = setup();
    const { run, file } = await download();
    run.browser.disconnect();
    await run.opened.exited;
    expect(service.download(target.session, file.id)).toBeUndefined();
    expect(existsSync(profile.downloadDir)).toBe(false);
  });

  it("removes unindexed files left by a previous server before opening the profile", async () => {
    const { service, profile } = setup();
    mkdirSync(join(profile.downloadDir, "old-id"), { recursive: true });
    writeFileSync(join(profile.downloadDir, "old-id", "report.txt"), "old download");
    writeFileSync(join(profile.downloadDir, "partial.crdownload"), "partial");
    const run = await service.running(profile);
    expect(run.browser.downloads!.list()).toEqual([]);
    expect(readdirSync(profile.downloadDir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a failed download cleanup leaves closing reset and can be retried", async () => {
    const { service, target, profile, download } = setup();
    await download();
    chmodSync(profile.downloadDir, 0o500);
    try {
      await expect(service.close(target.session)).rejects.toThrow();
      expect(profile.control.closing).toBe(false);
      expect(profile.stopping).toBeNull();
    } finally {
      chmodSync(profile.downloadDir, 0o700);
    }
    await service.close(target.session);
    expect(existsSync(profile.downloadDir)).toBe(false);
  });
});
