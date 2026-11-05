// A server's session credential is the HttpOnly cookie /pair set, held by Chromium's cookie jar, never by this file.
const MAX_NAME = 60;
const LOCAL_PLACE = Object.freeze({ server: null, active: "local" });

function normalizeOrigin(input) {
  if (typeof input !== "string") return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

function parsePairingLink(input) {
  const origin = normalizeOrigin(input);
  if (!origin) return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  // A code travels in the hash only: a query string reaches server logs.
  if (url.searchParams.has("code")) return null;
  const code = /(?:^|[#&])code=([^&]+)/.exec(url.hash)?.[1] ?? null;
  const isPairPage = url.pathname === "/pair" || url.pathname === "/pair/";
  if (code && !isPairPage) return null;
  try {
    return { origin, code: code ? decodeURIComponent(code) : null, url: code ? `${origin}/pair#code=${code}` : origin };
  } catch {
    return null;
  }
}

function parseHostedWorkspaceLink(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text || /[\s\\]/.test(text)) return null;
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    if (url.username || url.password || url.search || !["/", "/pair", "/pair/"].includes(url.pathname)) return null;
    if (!loopback && !url.hostname.includes(".")) return null;
    const parsed = parsePairingLink(url.href);
    if (!parsed || (url.hash && (!parsed.code || !/^[A-Z0-9-]{12,16}$/i.test(parsed.code)))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cleanName(value, fallback) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME) : "";
  return name || fallback;
}

function cleanServer(entry) {
  const origin = normalizeOrigin(entry?.origin);
  if (!origin) return null;
  return { origin, name: cleanName(entry?.name, new URL(origin).host), ...(entry?.microphone === true ? { microphone: true } : {}) };
}

/** The server the window shows, or null while it shows this computer. */
function activeServer(state) {
  return state?.active === "server" ? state.server ?? null : null;
}

/**
 * environments.json, any version, as the one place. Versions 1 and 2 listed places: only the one on screen survives,
 * and only when it was a server; a data folder of this computer that was on screen means this computer's default one.
 */
function parsePlace(raw) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return LOCAL_PLACE;
  }
  if (!value || typeof value !== "object") return LOCAL_PLACE;
  const version = value.version ?? 1;
  if (version === 3) {
    const server = value.active === "server" ? cleanServer(value.server) : null;
    return server ? { server, active: "server" } : LOCAL_PLACE;
  }
  if ((version !== 1 && version !== 2) || !Array.isArray(value.environments)) return LOCAL_PLACE;
  const active = value.environments.find((entry) => typeof entry?.id === "string" && entry.id === value.activeId);
  if (!active || active.kind === "local" || (active.kind !== undefined && active.kind !== "remote")) return LOCAL_PLACE;
  const server = cleanServer(active);
  return server ? { server, active: "server" } : LOCAL_PLACE;
}

function serializePlace(state) {
  const server = activeServer(state);
  return JSON.stringify({ version: 3, server, active: server ? "server" : "local" }, null, 2) + "\n";
}

/** The server at `origin` on screen; the same server keeps the microphone answer it was given. */
function withServer(state, { origin, name }) {
  const kept = activeServer(state)?.origin === normalizeOrigin(origin) ? activeServer(state) : null;
  const server = cleanServer({ origin, name: name ?? kept?.name, microphone: kept?.microphone });
  return server ? { server, active: "server" } : state;
}

function withMicrophone(state) {
  const server = activeServer(state);
  return server ? { server: { ...server, microphone: true }, active: "server" } : state;
}

/** What the window's pages learn of where the bots live. */
function placeView(state) {
  const server = activeServer(state);
  return server ? { kind: "server", url: server.origin, label: server.name } : { kind: "local" };
}

/** Native identity must not depend on a hosted renderer's version/title. */
function workspaceWindowTitle(state) {
  const server = activeServer(state);
  return server ? `Openpals — Hosted: ${server.name} (${new URL(server.origin).host})` : "Openpals";
}

/** Only the main process changes the place; a server's page must not navigate itself onto the local bridge. */
function workspaceNavigationAllowed(url, state, localOrigin) {
  try {
    return new URL(url).origin === (activeServer(state)?.origin ?? localOrigin);
  } catch {
    return false;
  }
}

/** Only the main window's main frame; being embedded in the server grants no host authority. */
function workspaceSenderAllowed(event, contents, state, localOrigin) {
  if (!contents || event?.sender !== contents || event?.senderFrame !== contents.mainFrame) return false;
  try {
    return workspaceNavigationAllowed(event.senderFrame.url, state, localOrigin);
  } catch {
    return false;
  }
}

/** Origins no page in the window may embed. */
function guardedOrigins(state, localOrigin) {
  return new Set([localOrigin, activeServer(state)?.origin].filter(Boolean));
}

module.exports = {
  LOCAL_PLACE,
  activeServer,
  guardedOrigins,
  normalizeOrigin,
  parseHostedWorkspaceLink,
  parsePairingLink,
  parsePlace,
  placeView,
  serializePlace,
  withMicrophone,
  withServer,
  workspaceNavigationAllowed,
  workspaceSenderAllowed,
  workspaceWindowTitle,
};
