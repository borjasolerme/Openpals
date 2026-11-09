import { useSyncExternalStore } from "react";
import { INSTALLER_URL, type ServerSetupBridge, type ServerSetupError, type ServerSetupProgress, type ServerSetupRequest } from "../../electron/server-setup.mjs";
import { t } from "@/lib/i18n";

export type { ServerSetupProgress, ServerSetupRequest };

/** What a person runs on their own Ubuntu or Debian server to install it by hand; it prints a pairing link. */
export const INSTALL_COMMAND = `curl -fsSL ${INSTALLER_URL} | bash`;

const bridge = () => (typeof window === "undefined" ? undefined : window.ogb?.serverSetup);

/** The desktop app can set up a server on this computer's own page; elsewhere only a pairing link connects one. */
export function serverSetupAvailable(): boolean {
  return Boolean(bridge());
}

/** What a stopped setup tells the person, and the installer's last lines when it has them. */
export function setupErrorText(error: ServerSetupError, request: ServerSetupRequest): string {
  const address = request.kind === "ssh" ? request.address.trim() : "";
  switch (error.code) {
    case "boat-key": return t("serverSetup.error.boatKey");
    case "boat-refused": return t("serverSetup.error.boatRefused", { message: error.message ?? "" });
    case "network": return t("serverSetup.error.network");
    case "timeout": return t("serverSetup.error.timeout");
    case "unreachable": return t("serverSetup.unreachable");
    case "ssh-address": return t("serverSetup.error.sshAddress");
    case "ssh-key": return t("serverSetup.error.sshKey", { address });
    case "ssh-host-key": return t("serverSetup.error.sshHostKey");
    case "ssh-unreachable": return t("serverSetup.error.sshUnreachable", { address });
    case "ssh-missing": return t("serverSetup.error.sshMissing");
    case "unsupported": return t("serverSetup.error.unsupported");
    case "install-failed": return t("serverSetup.error.installFailed");
  }
}

export interface SetupFailure {
  text: string;
  output?: string;
}

interface SetupState {
  progress: ServerSetupProgress | null;
  failure: SetupFailure | null;
}

const IDLE: SetupState = { progress: null, failure: null };

// One setup at a time per window, kept here rather than in a component: closing the first run or Settings while it
// runs, and opening either again, shows where it is.
let current: SetupState = IDLE;
let watched: ServerSetupBridge | undefined;
let stopWatching: (() => void) | undefined;
const listeners = new Set<() => void>();

function update(next: Partial<SetupState>): void {
  current = { ...current, ...next };
  for (const listener of listeners) listener();
}

/** Follows the bridge this page has; a new bridge (a reloaded test, a page that gained one) starts from idle. */
function watch(): void {
  const setup = bridge();
  if (setup === watched) return;
  stopWatching?.();
  watched = setup;
  current = IDLE;
  stopWatching = setup?.onProgress((progress) => {
    if (current.progress) update({ progress });
  });
}

function subscribe(listener: () => void): () => void {
  watch();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): SetupState {
  watch();
  return current;
}

async function start(request: ServerSetupRequest): Promise<void> {
  watch();
  const setup = watched;
  if (!setup || current.progress) return;
  update({ failure: null, progress: { step: request.kind === "boat" ? "creating" : "installing" } });
  try {
    const result = await setup.start(request);
    if (!result.ok) update({ progress: null, failure: { text: setupErrorText(result.error, request), output: result.error.output || undefined } });
  } catch (cause) {
    update({ progress: null, failure: { text: cause instanceof Error ? cause.message : String(cause) } });
  }
}

/** The window's server setup: where it is while it runs, and why it stopped. On success the desktop app opens the new
 * server, so this page goes away. */
export function useServerSetup(): SetupState & { start: (request: ServerSetupRequest) => Promise<void> } {
  const state = useSyncExternalStore(subscribe, snapshot, () => IDLE);
  return { ...state, start };
}
