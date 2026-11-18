import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LATEST_RELEASE_API, MAC_ASSET, RELEASES_PAGE, bundleOf, createAppUpdater, parseRelease, readBuildInfo, swapBundle,
  updateAvailable,
} from "./app-update.mjs";

const BUILT = { commit: "a".repeat(40), builtAt: "2026-11-10T12:00:00.000Z" };
const NEXT = "b".repeat(40);
const ASSET_URL = `https://github.com/borjasolerme/Openpals/releases/download/v2/${MAC_ASSET}`;
const releaseJson = (overrides = {}) => ({
  target_commitish: NEXT,
  published_at: "2026-11-15T09:00:00Z",
  html_url: "https://github.com/borjasolerme/Openpals/releases/tag/v2",
  draft: false,
  prerelease: false,
  assets: [{ name: "notes.txt", browser_download_url: "https://example.test/notes.txt" }, { name: MAC_ASSET, browser_download_url: ASSET_URL }],
  ...overrides,
});

test("an update is a release from another commit, published after this app was built", () => {
  const latest = { commit: NEXT, publishedAt: "2026-11-15T09:00:00Z" };
  assert.equal(updateAvailable(BUILT, latest), true);
  assert.equal(updateAvailable(BUILT, { ...latest, commit: BUILT.commit }), false, "the release this app was built for");
  assert.equal(updateAvailable(BUILT, { ...latest, commit: BUILT.commit.slice(0, 12) }), false, "a short sha of the same commit");
  assert.equal(updateAvailable(BUILT, { ...latest, publishedAt: "2026-11-01T00:00:00Z" }), false, "an older release than this build");
  assert.equal(updateAvailable({ commit: "", builtAt: "" }, latest), false, "a development run never claims one");
});

test("the latest release is reduced to its commit, date, page and the macOS zip, and only from this repository", () => {
  assert.deepEqual(parseRelease(releaseJson()), {
    commit: NEXT, publishedAt: "2026-11-15T09:00:00Z", url: "https://github.com/borjasolerme/Openpals/releases/tag/v2", assetUrl: ASSET_URL,
  });
  assert.equal(parseRelease(releaseJson({ assets: [] })).assetUrl, null);
  assert.equal(parseRelease(releaseJson({ assets: [{ name: MAC_ASSET, browser_download_url: "https://evil.test/Openpals-mac-arm64.zip" }] })).assetUrl, null);
  assert.equal(parseRelease(releaseJson({ html_url: "https://evil.test/" })).url, RELEASES_PAGE);
  assert.equal(parseRelease(releaseJson({ target_commitish: "" })), null);
  assert.equal(parseRelease(releaseJson({ published_at: "soon" })), null);
  assert.equal(parseRelease(releaseJson({ draft: true })), null);
  assert.equal(parseRelease(null), null);
});

test("build info is read only when it holds a full sha and a date", () => {
  assert.deepEqual(readBuildInfo("x", () => JSON.stringify(BUILT)), BUILT);
  assert.deepEqual(readBuildInfo("x", () => JSON.stringify({ commit: "abc", builtAt: BUILT.builtAt })), { commit: "", builtAt: "" });
  assert.deepEqual(readBuildInfo("x", () => { throw new Error("ENOENT"); }), { commit: "", builtAt: "" });
});

test("the running bundle is the .app around the executable, never a translocated copy", () => {
  assert.equal(bundleOf("/Applications/Openpals.app/Contents/MacOS/Openpals"), "/Applications/Openpals.app");
  assert.equal(bundleOf("/usr/local/bin/electron"), null);
  assert.equal(bundleOf("/private/var/folders/x/AppTranslocation/1234/d/Openpals.app/Contents/MacOS/Openpals"), null);
});

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openpals-update-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "Applications", "Openpals.app");
  fs.mkdirSync(path.join(target, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(target, "Contents", "version"), "old");
  const tmpdir = path.join(root, "tmp");
  fs.mkdirSync(tmpdir);
  return { root, target, tmpdir, executable: path.join(target, "Contents", "MacOS", "Openpals") };
}

/** codesign and ditto, faked: ditto -x writes an Openpals.app holding "new"; codesign reports `teams` by bundle. */
function fakeExecFile({ teams = { running: "4FC2CMN88J", download: "4FC2CMN88J" }, verifies = true } = {}) {
  const calls = [];
  const execFile = (file, args, _options, callback) => {
    calls.push([file, ...args]);
    if (file === "/usr/bin/ditto" && args[0] === "-x") {
      fs.mkdirSync(path.join(args[3], "Openpals.app", "Contents"), { recursive: true });
      fs.writeFileSync(path.join(args[3], "Openpals.app", "Contents", "version"), "new");
      return callback(null, "", "");
    }
    if (file === "/usr/bin/codesign" && args[0] === "--verify") return callback(verifies ? null : new Error("a sealed resource is missing or invalid"), "", "");
    if (file === "/usr/bin/codesign" && args[0] === "-dv") {
      const team = args[2].includes(`${path.sep}unpacked${path.sep}`) ? teams.download : teams.running;
      return callback(null, "", `Executable=${args[2]}\nIdentifier=com.openpals.app\nTeamIdentifier=${team}\n`);
    }
    return callback(new Error(`unexpected ${file} ${args.join(" ")}`), "", "");
  };
  return { execFile, calls };
}

function fakeFetch(release = releaseJson()) {
  const requests = [];
  const fetch = async (url) => {
    requests.push(url);
    if (url === LATEST_RELEASE_API) return Response.json(release);
    if (url === ASSET_URL) return new Response(new Uint8Array(4096), { headers: { "content-length": "4096" } });
    return new Response("missing", { status: 404 });
  };
  return { fetch, requests };
}

function updater(t, overrides = {}) {
  const box = sandbox(t);
  const states = [];
  const relaunched = [];
  const trashed = [];
  const { execFile, calls } = overrides.exec ?? fakeExecFile();
  const { fetch, requests } = overrides.fetch ?? fakeFetch();
  const instance = createAppUpdater({
    platform: "darwin", packaged: true, build: BUILT, executable: box.executable, tmpdir: box.tmpdir,
    fetch, execFile, fs: overrides.fs ?? fsp,
    trash: async (file) => { trashed.push(file); await fsp.rm(file, { recursive: true, force: true }); },
    relaunch: () => relaunched.push(true), emit: (state) => states.push(state),
    ...overrides.options,
  });
  return { box, instance, states, relaunched, trashed, calls, requests };
}

const version = (bundle) => fs.readFileSync(path.join(bundle, "Contents", "version"), "utf8");

test("check says available, current or error, with the release but never a file path", async (t) => {
  const { instance, states } = updater(t);
  const result = await instance.check();
  assert.deepEqual(result, {
    state: "available", current: BUILT, canInstall: true, downloadPage: "https://github.com/borjasolerme/Openpals/releases/tag/v2",
    latest: { commit: NEXT, publishedAt: "2026-11-15T09:00:00Z", url: "https://github.com/borjasolerme/Openpals/releases/tag/v2" },
  });
  assert.deepEqual(states.map((state) => state.state), ["checking", "available"]);
  assert.ok(!JSON.stringify(states).includes(os.tmpdir()));

  const same = updater(t, { fetch: fakeFetch(releaseJson({ target_commitish: BUILT.commit })) });
  assert.equal((await same.instance.check()).state, "current");

  const offline = updater(t, { fetch: { fetch: async () => { throw new TypeError("fetch failed"); }, requests: [] } });
  assert.deepEqual(await offline.instance.check(), { state: "error", error: "check", current: BUILT, canInstall: false, downloadPage: RELEASES_PAGE });
});

test("only the packaged macOS app with a macOS zip on the release can update itself; elsewhere it links the release page", async (t) => {
  assert.equal((await updater(t, { options: { platform: "win32" } }).instance.check()).canInstall, false);
  assert.equal((await updater(t, { options: { packaged: false } }).instance.check()).canInstall, false);
  assert.equal((await updater(t, { fetch: fakeFetch(releaseJson({ assets: [] })) }).instance.check()).canInstall, false);
  const dev = await updater(t, { options: { build: { commit: "", builtAt: "" } } }).instance.check();
  assert.equal(dev.state, "error");
  assert.equal(dev.error, "unpackaged");
});

test("install downloads, verifies the signature and team, swaps the bundle, trashes the old one and relaunches", async (t) => {
  const { box, instance, states, relaunched, trashed, calls } = updater(t);
  await instance.check();
  await instance.install();
  assert.equal(version(box.target), "new");
  assert.equal(relaunched.length, 1);
  assert.equal(trashed.length, 1);
  assert.match(path.basename(trashed[0]), /^\.Openpals\.app\.previous-\d+$/);
  assert.deepEqual(fs.readdirSync(box.tmpdir), [], "the download is cleaned up");
  assert.deepEqual([...new Set(states.map((state) => state.state))], ["checking", "available", "downloading", "verifying", "installing"]);
  assert.equal(states.findLast((state) => state.state === "downloading").percent, 100);
  const order = calls.map(([file, first]) => `${path.basename(file)} ${first}`);
  assert.deepEqual(order, ["ditto -x", "codesign -dv", "codesign --verify", "codesign -dv"]);
  for (const call of calls) assert.ok(call.every((arg) => typeof arg === "string"), "every command is argv, never a shell string");
});

test("install refuses a download whose signature does not verify, and leaves the app as it was", async (t) => {
  const { box, instance, relaunched, trashed } = updater(t, { exec: fakeExecFile({ verifies: false }) });
  await instance.check();
  const result = await instance.install();
  assert.equal(result.state, "error");
  assert.equal(result.error, "verify");
  assert.equal(version(box.target), "old");
  assert.deepEqual([relaunched.length, trashed.length], [0, 0]);
  assert.deepEqual(fs.readdirSync(box.tmpdir), []);
});

test("install refuses a validly signed download from another team", async (t) => {
  const { box, instance, relaunched } = updater(t, { exec: fakeExecFile({ teams: { running: "4FC2CMN88J", download: "EVILTEAM00" } }) });
  await instance.check();
  const result = await instance.install();
  assert.equal(result.error, "verify");
  assert.equal(version(box.target), "old");
  assert.equal(relaunched.length, 0);
});

test("install refuses when the running app has no team to compare against", async (t) => {
  const { box, instance } = updater(t, { exec: fakeExecFile({ teams: { running: "not set", download: "not set" } }) });
  await instance.check();
  assert.equal((await instance.install()).error, "verify");
  assert.equal(version(box.target), "old");
});

test("install is refused before a check found an installable update", async (t) => {
  const { instance } = updater(t, { fetch: fakeFetch(releaseJson({ target_commitish: BUILT.commit })) });
  await assert.rejects(instance.install(), /No update is ready/);
  await instance.check();
  await assert.rejects(instance.install(), /No update is ready/);
});

test("a failed swap puts the old app back where it was", async (t) => {
  const box = sandbox(t);
  const next = path.join(box.tmpdir, "Openpals.app");
  fs.mkdirSync(path.join(next, "Contents"), { recursive: true });
  fs.writeFileSync(path.join(next, "Contents", "version"), "new");
  const failing = {
    ...fsp,
    rename: async (from, to) => {
      if (from === next) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      return fsp.rename(from, to);
    },
  };
  await assert.rejects(swapBundle({ fs: failing, run: async () => ({}), next, target: box.target }), /Could not put the new app in place/);
  assert.equal(version(box.target), "old");
  assert.deepEqual(fs.readdirSync(path.dirname(box.target)), ["Openpals.app"], "no leftover aside copy");
});

test("a swap across volumes copies with ditto, and a failed copy is rolled back too", async (t) => {
  const box = sandbox(t);
  const next = path.join(box.tmpdir, "Openpals.app");
  fs.mkdirSync(next);
  const crossDevice = { ...fsp, rename: async (from, to) => {
    if (from === next) throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    return fsp.rename(from, to);
  } };
  const runs = [];
  const halfCopy = async (file, args) => {
    runs.push([file, ...args]);
    fs.mkdirSync(args[1]);
    throw new Error("disk full");
  };
  await assert.rejects(swapBundle({ fs: crossDevice, run: halfCopy, next, target: box.target }), /disk full/);
  assert.deepEqual(runs, [["/usr/bin/ditto", next, box.target]]);
  assert.equal(version(box.target), "old");
});

test("an install that fails after download reports install, not a crash, and keeps the app", async (t) => {
  const failing = { ...fsp, rename: async () => { throw Object.assign(new Error("read-only volume"), { code: "EROFS" }); } };
  const { box, instance, relaunched } = updater(t, { fs: failing });
  await instance.check();
  const result = await instance.install();
  assert.equal(result.state, "error");
  assert.equal(result.error, "install");
  assert.equal(version(box.target), "old");
  assert.equal(relaunched.length, 0);
});
