// The person's own keys for the services the bots use, resolved per request. A key goes only to its service's base URL.
import { JEV_DEFAULT_BASE_URL } from "./decider/jev.ts";

export const BOAT_API_DEFAULT = "https://boat.dev/api/v1";
export const ELEVENLABS_API_DEFAULT = "https://api.elevenlabs.io/v1";
export const TREG_API_DEFAULT = "https://treg.to";

export interface ServiceCredential {
  token: string;
  /** The only base URL this token is ever sent to. */
  api: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function own(token: string | undefined, api: string): ServiceCredential | null {
  const secret = token?.trim();
  return secret ? { token: secret, api } : null;
}

export const boatProviderApi = (env: NodeJS.ProcessEnv = process.env): string => env.OMB_BOAT_API || BOAT_API_DEFAULT;
export const elevenLabsProviderApi = (env: NodeJS.ProcessEnv = process.env): string =>
  env.OMB_ELEVENLABS_API || ELEVENLABS_API_DEFAULT;

/** Security: the person's treg key goes only to treg (https), or to a loopback stand-in in development and tests. */
export function tregProviderApi(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OMB_TREG_URL?.trim().replace(/\/+$/, "");
  if (!configured) return TREG_API_DEFAULT;
  try {
    const parsed = new URL(configured);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname)) ? configured : TREG_API_DEFAULT;
  } catch {
    return TREG_API_DEFAULT;
  }
}

export function boatCredential(token: string | undefined, env: NodeJS.ProcessEnv = process.env): ServiceCredential | null {
  return own(token, boatProviderApi(env));
}

export function voiceCredential(token: string | undefined, env: NodeJS.ProcessEnv = process.env): ServiceCredential | null {
  return own(token, elevenLabsProviderApi(env));
}

export function deciderCredential(token: string | undefined, baseUrl: string | undefined): ServiceCredential | null {
  return own(token, baseUrl?.trim() || JEV_DEFAULT_BASE_URL);
}

/** The X and research tools' credential: the person's own treg key; null without one, and then no bot is shown the tools. */
export function researchCredential(token: string | undefined, env: NodeJS.ProcessEnv = process.env): ServiceCredential | null {
  return own(token, tregProviderApi(env));
}
