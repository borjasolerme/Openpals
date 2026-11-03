import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { appPermissionAllowed, appPermissionHandlers, emailDraftUrl, externalLinkUrl, externalWebUrl, remoteClipboardWriteAllowed } from "./app-permissions.mjs";

const LOCAL_ORIGIN = "http://127.0.0.1:5199";
const LOCAL_PAGE = "http://127.0.0.1:5199/chat?botId=bot-1";

test("grants notifications, clipboard, and fullscreen to the local renderer page", () => {
  for (const permission of ["notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"]) {
    assert.equal(appPermissionAllowed(permission, LOCAL_PAGE, LOCAL_ORIGIN), true, permission);
  }
});

test("accepts a bare origin or a full URL on either side", () => {
  assert.equal(appPermissionAllowed("notifications", LOCAL_ORIGIN, LOCAL_ORIGIN), true);
  assert.equal(appPermissionAllowed("notifications", `${LOCAL_ORIGIN}/settings#voice`, `${LOCAL_ORIGIN}/`), true);
  assert.equal(appPermissionAllowed("fullscreen", "http://127.0.0.1:8799/chat", "http://127.0.0.1:8799"), true);
});

test("allows media for audio (microphone) and guarded display-capture, denies video (camera)", () => {
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["audio"] }), true);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "audio" }), true);

  // Electron 43 routes getDisplayMedia through permission="media" with an empty mediaTypes array.
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: [] }), true);

  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["video"] }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["audio", "video"] }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "video" }), false);

  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "unknown" }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, {}), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN), false);
});

test("refuses permissions to any other origin", () => {
  assert.equal(appPermissionAllowed("notifications", "https://other.example/chat", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("clipboard-read", "http://127.0.0.1:5200/", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("media", "https://127.0.0.1:5199/", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("fullscreen", "http://localhost:5199/", LOCAL_ORIGIN), false);
});

test("keeps every privileged capability off even for the local renderer page", () => {
  const privileged = [
    "geolocation", "camera", "usb", "hid", "serial", "midi", "midiSysex",
    "display-capture", "fileSystem", "openExternal", "idle-detection", "speaker-selection",
    "window-management", "storage-access", "top-level-storage-access", "pointerLock",
    "keyboardLock", "mediaKeySystem", "unknown",
  ];
  for (const permission of privileged) {
    assert.equal(appPermissionAllowed(permission, LOCAL_PAGE, LOCAL_ORIGIN), false, permission);
  }
  assert.equal(appPermissionAllowed(undefined, LOCAL_PAGE, LOCAL_ORIGIN), false);
});

test("rejects mixed, unknown, and conflicting media details", () => {
  for (const details of [
    { mediaTypes: ["audio", "unknown"] }, { mediaTypes: ["unknown"] },
    { mediaType: "audio", mediaTypes: ["video"] },
    { mediaType: "unknown", mediaTypes: [] }, { mediaTypes: "audio" }, null,
  ]) assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, details), false);
});

test("web links reject embedded credentials and non-web schemes", () => {
  assert.equal(externalWebUrl("https://example.com/help?q=hello#more"), "https://example.com/help?q=hello#more");
  assert.equal(externalWebUrl("http://127.0.0.1:8799"), "http://127.0.0.1:8799/");
  for (const url of ["https://user:pass@example.com", "http://user@example.com", "https://:pass@example.com"])
    assert.throws(() => externalWebUrl(url), /credentials/);
  for (const url of ["file:///tmp/test", "javascript:alert(1)", "data:text/html,test", "mailto:test@example.com"])
    assert.throws(() => externalWebUrl(url), /Only web/);
  for (const url of [null, 123, "not a url"])
    assert.throws(() => externalWebUrl(url), /web address/);
});

test("an email link opens only as a draft to one address with a subject and a body", () => {
  const draft = "mailto:support@example.com?subject=Hello%20there&body=Line%20one%0D%0ALine%20two";
  assert.equal(emailDraftUrl(draft), draft);
  assert.equal(externalLinkUrl(draft), draft);
  assert.equal(externalLinkUrl("MAILTO:support@example.com?Subject=Hi"), "mailto:support@example.com?Subject=Hi");
  assert.equal(externalLinkUrl("https://example.com/help"), "https://example.com/help");
  for (const url of ["mailto:a@example.com,b@example.com", "mailto:a%2Cb@example.com", "mailto:?to=a@example.com", "mailto:", "mailto:nobody"])
    assert.throws(() => externalLinkUrl(url), /one address/, url);
  for (const url of ["mailto:a@example.com?attach=/etc/passwd", "mailto:a@example.com?subject=Hi&cc=b@example.com", "mailto:a@example.com?bcc=b@example.com",
    "mailto:a@example.com?to=b@example.com", "mailto:a@example.com?Attachment=~/.ssh/id_rsa"])
    assert.throws(() => externalLinkUrl(url), /only a subject and a body/, url);
  assert.throws(() => emailDraftUrl("mailto:a%E0%A4%A@example.com"), /invalid/);
  assert.throws(() => emailDraftUrl("https://example.com"), /Only email links/);
  for (const url of ["file:///tmp/test", "javascript:alert(1)", "data:text/html,test", "tel:+15555550100", "sms:+15555550100"])
    assert.throws(() => externalLinkUrl(url), /Only web/, url);
  for (const url of [null, 123, "not a url"])
    assert.throws(() => externalLinkUrl(url), /web address/);
});

test("both external-link entry points use the policy and IPC retains the local-origin gate", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.handle\("desktop:open-external", localOnly\("desktop:open-external"/);
  assert.match(main, /shell\.openExternal\(externalLinkUrl\(rawUrl\)\)/);
  assert.match(main, /shell\.openExternal\(externalLinkUrl\(url\)\)/);
  assert.doesNotMatch(main, /shell\.openExternal\(externalWebUrl\(/);
});

test("fails closed on unparsable or opaque origins", () => {
  assert.equal(appPermissionAllowed("notifications", "not a url", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", "", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", undefined, LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", null, LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", LOCAL_PAGE, "not a url"), false);
  assert.equal(appPermissionAllowed("notifications", LOCAL_PAGE, undefined), false);
  // Opaque origins all serialise as "null"; two of them must never match.
  assert.equal(appPermissionAllowed("notifications", "data:text/html,x", "about:blank"), false);
  assert.equal(appPermissionAllowed("notifications", "javascript:alert(1)", LOCAL_ORIGIN), false);
});

test("this computer's own page keeps its permissions through the same handlers", () => {
  const handlers = appPermissionHandlers({ rendererOrigin: () => LOCAL_ORIGIN, mainContents: () => null });
  const local = { getURL: () => LOCAL_PAGE };
  const ask = (permission, details) => { let granted; handlers.request(local, permission, (value) => { granted = value; }, details); return granted; };
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: ["audio"] }), true);
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: [] }), true, "guarded display capture");
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: ["video"] }), false);
  assert.equal(ask("notifications", { requestingUrl: LOCAL_PAGE, isMainFrame: true }), true);
  assert.equal(ask("notifications", {}), true);
  assert.equal(handlers.check(local, "clipboard-read", "", { isMainFrame: true }), true);
  assert.equal(handlers.check(local, "clipboard-read", "https://other.example", { isMainFrame: true }), false);
});

test("the app installs these handlers", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /setPermissionRequestHandler\(appPermissions\.request\)/);
  assert.match(main, /setPermissionCheckHandler\(appPermissions\.check\)/);
});

const ipcFrom = (contents, frameUrl, { mainFrame = true } = {}) => {
  const frame = { url: frameUrl };
  if (mainFrame) contents.mainFrame = frame;
  else contents.mainFrame ??= { url: contents.getURL() };
  return { sender: contents, senderFrame: frame };
};

test("a page asking about its microphone hears whether this app lets it use it", () => {
  const main = { getURL: () => "https://my-vps.example.com/chat" };
  const handlers = appPermissionHandlers({ rendererOrigin: () => LOCAL_ORIGIN, mainContents: () => main });
  const local = { getURL: () => LOCAL_PAGE };
  assert.equal(handlers.pageMicrophone(ipcFrom(local, LOCAL_PAGE)), "allowed", "this computer's own page");
  assert.equal(handlers.pageMicrophone(ipcFrom(main, "https://my-vps.example.com/chat")), "refused", "another server");
  assert.equal(handlers.pageMicrophone({ sender: main, senderFrame: null }), "refused", "a frame that is gone");
  assert.equal(handlers.pageMicrophone(undefined), "refused", "no sender");
});

const REMOTE = "https://viernes.tail1.ts.net:9444";

test("a remote server may write clipboard text only as the active origin's main frame", () => {
  const write = "clipboard-sanitized-write";
  assert.equal(remoteClipboardWriteAllowed(write, `${REMOTE}/chat?x=1`, REMOTE, { isMainFrame: true }), true);
  assert.equal(remoteClipboardWriteAllowed(write, REMOTE, `${REMOTE}/`, { isMainFrame: true }), true);
  for (const permission of ["clipboard-read", "notifications", "fullscreen", "media", "geolocation", "camera", "openExternal", "unknown", undefined]) {
    assert.equal(remoteClipboardWriteAllowed(permission, REMOTE, REMOTE, { isMainFrame: true }), false, String(permission));
  }
  for (const details of [{ isMainFrame: false }, {}, undefined, null, { isMainFrame: "true" }]) {
    assert.equal(remoteClipboardWriteAllowed(write, REMOTE, REMOTE, details), false);
  }
  for (const requesting of [
    "https://viernes.tail1.ts.net:9445/", "https://viernes.tail1.ts.net/", "http://viernes.tail1.ts.net:9444/",
    "https://other.tail1.ts.net:9444/", "https://viernes.tail1.ts.net.evil.test:9444/", "https://evil.test/#https://viernes.tail1.ts.net:9444",
    "about:blank", "data:text/html,x", "javascript:alert(1)", "not a url", "", null, undefined,
  ]) assert.equal(remoteClipboardWriteAllowed(write, requesting, REMOTE, { isMainFrame: true }), false, String(requesting));
  for (const active of [undefined, null, "", "not a url", "about:blank", "data:text/html,x"]) {
    assert.equal(remoteClipboardWriteAllowed(write, REMOTE, active, { isMainFrame: true }), false, String(active));
    assert.equal(remoteClipboardWriteAllowed(write, "about:blank", active, { isMainFrame: true }), false);
  }
});

test("the base policy itself still grants a remote origin nothing", () => {
  for (const permission of ["clipboard-sanitized-write", "clipboard-read", "notifications", "fullscreen"]) {
    assert.equal(appPermissionAllowed(permission, REMOTE, LOCAL_ORIGIN, { isMainFrame: true }), false, permission);
  }
});

test("the active remote server's page may show notifications and go fullscreen, in the main window's main frame only", () => {
  const state = { remote: REMOTE, main: { getURL: () => `${REMOTE}/chat` } };
  const handlers = appPermissionHandlers({ rendererOrigin: () => LOCAL_ORIGIN, mainContents: () => state.main,
    activeRemoteOrigin: () => state.remote });
  const onRemote = (extra = {}) => ({ requestingUrl: `${REMOTE}/settings`, isMainFrame: true, ...extra });
  const ask = (details, contents = state.main, permission = "notifications") => {
    let granted; handlers.request(contents, permission, (value) => { granted = value; }, details); return granted;
  };
  assert.equal(ask(onRemote()), true);
  assert.equal(handlers.check(state.main, "notifications", REMOTE, { isMainFrame: true }), true);
  assert.equal(ask(onRemote({ isMainFrame: false })), false, "a frame inside it");
  assert.equal(handlers.check(state.main, "notifications", REMOTE, {}), false, "a frame it cannot vouch for");
  assert.equal(ask(onRemote(), { getURL: () => `${REMOTE}/` }), false, "another window");
  assert.equal(ask(onRemote({ requestingUrl: "https://other.tail1.ts.net:9444/" })), false, "another server");
  assert.equal(ask(onRemote(), state.main, "fullscreen"), true, "a chat video's fullscreen button");
  assert.equal(handlers.check(state.main, "fullscreen", REMOTE, { isMainFrame: true }), true);
  assert.equal(ask(onRemote({ isMainFrame: false }), state.main, "fullscreen"), false, "fullscreen from a frame inside it");
  assert.equal(ask(onRemote({ requestingUrl: "https://other.tail1.ts.net:9444/" }), state.main, "fullscreen"), false, "fullscreen for another server");
  assert.equal(ask(onRemote(), { getURL: () => `${REMOTE}/` }, "fullscreen"), false, "fullscreen in another window");
  for (const permission of ["geolocation", "camera", "clipboard-read"]) {
    assert.equal(ask(onRemote(), state.main, permission), false, permission);
  }
  state.remote = null;
  assert.equal(ask(onRemote()), false, "no active remote: at once");
  assert.equal(ask(onRemote(), state.main, "fullscreen"), false, "no active remote: no fullscreen");
  for (const requesting of ["about:blank", "data:text/html,x", ""]) assert.equal(ask(onRemote({ requestingUrl: requesting })), false, `${requesting || "(empty)"}`);
});
