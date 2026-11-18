// Check for updates: this fork's own releases on GitHub, compared by commit, installed in place on macOS.
import { execFile as nodeExecFile } from "node:child_process";
import nodeFs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = "borjasolerme/Openpals";
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const RELEASE_PAGE_PREFIX = `https://github.com/${REPO}/releases/`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
/** The release asset, a `ditto -c -k --keepParent` zip of Openpals.app. */
export const MAC_ASSET = "Openpals-mac-arm64.zip";
const ZIPPED_APP = "Openpals.app";
/** Written into the package's Resources by scripts/after-pack.mjs. */
export const BUILD_INFO_FILE = "build-info.json";

const CHECK_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3;
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA = /^[0-9a-f]{7,40}$/;

const NO_BUILD = Object.freeze({ commit: "", builtAt: "" });

/** The commit and build time a package carries; empty in a development run. */
export function readBuildInfo(file, read = (name) => readFileSync(name, "utf8")) {
  try {
    const info = JSON.parse(read(file));
    const commit = String(info?.commit ?? "").toLowerCase();
    const builtAt = String(info?.builtAt ?? "");
    return FULL_SHA.test(commit) && Number.isFinite(Date.parse(builtAt)) ? { commit, builtAt } : NO_BUILD;
  } catch {
    return NO_BUILD;
  }
}

/** GitHub's latest-release JSON, reduced to what the check compares; null when it is not a usable release. */
export function parseRelease(json) {
  const commit = typeof json?.target_commitish === "string" ? json.target_commitish.trim().toLowerCase() : "";
  const publishedAt = typeof json?.published_at === "string" ? json.published_at : "";
  if (!commit || !Number.isFinite(Date.parse(publishedAt)) || json?.draft === true || json?.prerelease === true) return null;
  const url = typeof json.html_url === "string" && json.html_url.startsWith(RELEASE_PAGE_PREFIX) ? json.html_url : RELEASES_PAGE;
  const asset = Array.isArray(json.assets) ? json.assets.find((entry) => entry?.name === MAC_ASSET) : undefined;
  const assetUrl = typeof asset?.browser_download_url === "string" && asset.browser_download_url.startsWith(DOWNLOAD_PREFIX)
    ? asset.browser_download_url : null;
  return { commit, publishedAt, url, assetUrl };
}

function sameCommit(left, right) {
  if (left === right) return true;
  return SHA.test(left) && SHA.test(right) && (left.startsWith(right) || right.startsWith(left));
}

/** A release is newer when it was built from another commit and published after this app was built. */
export function updateAvailable(current, latest) {
  if (!current.commit || !latest) return false;
  return !sameCommit(current.commit, latest.commit) && Date.parse(latest.publishedAt) > Date.parse(current.builtAt);
}

/** The .app bundle around a macOS executable (…/Openpals.app/Contents/MacOS/Openpals), or null. */
export function bundleOf(executable) {
  const bundle = path.resolve(executable, "..", "..", "..");
  if (!bundle.endsWith(".app")) return null;
  // Gatekeeper runs a quarantined app from a read-only random copy; replacing that copy changes nothing.
  if (bundle.includes("/AppTranslocation/")) return null;
  return bundle;
}

class UpdateError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

function execFileAsync(execFile, file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }));
      else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

/** The team and bundle identifier a bundle is signed with; `codesign -dv` writes them to stderr. */
async function signingIdentity(run, bundle) {
  const { stdout, stderr } = await run("/usr/bin/codesign", ["-dv", "--verbose=2", bundle]);
  const text = `${stdout}\n${stderr}`;
  const team = /^TeamIdentifier=(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  const identifier = /^Identifier=(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  return { team: team === "not set" ? "" : team, identifier };
}

/**
 * Security: the download is never opened or run before `codesign --verify --deep --strict` accepts it and its
 * TeamIdentifier and bundle identifier equal the running app's.
 */
export async function verifyDownloadedApp(run, downloaded, running) {
  const own = await signingIdentity(run, running).catch(() => ({ team: "", identifier: "" }));
  if (!own.team) throw new UpdateError("verify", "This app is not signed by a team, so no update can be checked against it");
  try {
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", downloaded]);
  } catch {
    throw new UpdateError("verify", "The download's signature is not valid");
  }
  const next = await signingIdentity(run, downloaded).catch(() => ({ team: "", identifier: "" }));
  if (next.team !== own.team || next.identifier !== own.identifier) {
    throw new UpdateError("verify", `The download is signed by ${next.team || "no team"}, not ${own.team}`);
  }
}

/** Puts `next` where `target` is, keeping the old bundle aside until the new one is in place; on failure the old one goes back. */
export async function swapBundle({ fs, run, next, target, now = Date.now }) {
  const previous = path.join(path.dirname(target), `.${path.basename(target)}.previous-${now()}`);
  try {
    await fs.rename(target, previous);
  } catch (error) {
    throw new UpdateError("install", `Could not move the current app aside: ${error.message}`);
  }
  try {
    try {
      await fs.rename(next, target);
    } catch (error) {
      if (error?.code !== "EXDEV") throw error;
      await run("/usr/bin/ditto", [next, target]);
    }
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    await fs.rename(previous, target);
    throw new UpdateError("install", `Could not put the new app in place: ${error.message}`);
  }
  return previous;
}

async function download(fetch, fs, url, file, onPercent) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new UpdateError("download", `Download failed (${response.status})`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (total > MAX_DOWNLOAD_BYTES) throw new UpdateError("download", "The download is too large");
  const handle = await fs.open(file, "w");
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > MAX_DOWNLOAD_BYTES) throw new UpdateError("download", "The download is too large");
      await handle.write(chunk);
      if (total) onPercent(Math.min(100, Math.floor((received * 100) / total)));
    }
  } finally {
    await handle.close();
  }
}

/**
 * The update check and install, one at a time. `emit` receives every snapshot the row shows; the renderer never
 * learns a file path.
 */
export function createAppUpdater({
  platform = process.platform,
  packaged,
  build,
  executable,
  fetch = globalThis.fetch,
  execFile = nodeExecFile,
  fs = nodeFs,
  tmpdir = os.tmpdir(),
  trash = (file) => fs.rm(file, { recursive: true, force: true }),
  relaunch,
  emit = () => {},
  log = () => {},
}) {
  const run = (file, args) => execFileAsync(execFile, file, args);
  const bundle = platform === "darwin" && packaged ? bundleOf(executable) : null;
  let release = null;
  let snapshot = { state: "idle", current: { ...build }, canInstall: false, downloadPage: RELEASES_PAGE };
  let busy = null;

  const publicLatest = () => (release ? { latest: { commit: release.commit, publishedAt: release.publishedAt, url: release.url } } : {});
  const set = (next) => {
    snapshot = { current: { ...build }, canInstall: false, downloadPage: release?.url ?? RELEASES_PAGE, ...publicLatest(), ...next };
    emit(snapshot);
    return snapshot;
  };

  async function latestRelease() {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) throw new UpdateError("check", `GitHub answered ${response.status}`);
    const parsed = parseRelease(await response.json());
    if (!parsed) throw new UpdateError("check", "The latest release has no commit or date");
    return parsed;
  }

  async function check() {
    if (busy) return busy;
    set({ state: "checking" });
    busy = (async () => {
      try {
        release = await latestRelease();
        if (!build.commit) return set({ state: "error", error: "unpackaged" });
        if (!updateAvailable(build, release)) return set({ state: "current" });
        return set({ state: "available", canInstall: Boolean(bundle && release.assetUrl) });
      } catch (error) {
        log(`update check failed: ${error.message}`);
        return set({ state: "error", error: "check" });
      } finally {
        busy = null;
      }
    })();
    return busy;
  }

  async function install() {
    if (busy) return busy;
    if (snapshot.state !== "available" || !snapshot.canInstall || !release?.assetUrl || !bundle) {
      throw new Error("No update is ready to install");
    }
    const asset = release.assetUrl;
    busy = (async () => {
      let dir = null;
      try {
        set({ state: "downloading", percent: 0 });
        dir = await fs.mkdtemp(path.join(tmpdir, "openpals-update-"));
        const zip = path.join(dir, MAC_ASSET);
        let shown = 0;
        await download(fetch, fs, asset, zip, (percent) => {
          if (percent !== shown) set({ state: "downloading", percent: (shown = percent) });
        });
        set({ state: "verifying" });
        const unpacked = path.join(dir, "unpacked");
        await fs.mkdir(unpacked);
        await run("/usr/bin/ditto", ["-x", "-k", zip, unpacked]);
        const next = path.join(unpacked, ZIPPED_APP);
        const details = await fs.lstat(next).catch(() => null);
        if (!details?.isDirectory()) throw new UpdateError("verify", `The download has no ${ZIPPED_APP}`);
        await verifyDownloadedApp(run, next, bundle);
        set({ state: "installing" });
        const previous = await swapBundle({ fs, run, next, target: bundle });
        await Promise.resolve(trash(previous)).catch((error) => log(`could not move the previous app to the Trash: ${error.message}`));
        log(`installed ${release.commit} over ${build.commit}`);
        relaunch();
        return snapshot;
      } catch (error) {
        log(`update install failed: ${error.message}`);
        return set({ state: "error", error: error instanceof UpdateError && error.code === "verify" ? "verify" : "install" });
      } finally {
        if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        busy = null;
      }
    })();
    return busy;
  }

  return { state: () => snapshot, check, install };
}

/** IPC for this computer's own page (`guard`); install only from the main window (`installGuard`). */
export function installAppUpdateIpc({ ipcMain, guard, installGuard = (_event) => {}, updater }) {
  ipcMain.handle("updates:state", guard("updates:state", () => updater.state()));
  ipcMain.handle("updates:check", guard("updates:check", () => updater.check()));
  ipcMain.handle("updates:install", guard("updates:install", (event) => {
    installGuard(event);
    return updater.install();
  }));
}
