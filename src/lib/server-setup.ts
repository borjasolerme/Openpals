import { useCallback, useEffect, useState } from "react";
import type { ServerSetupError, ServerSetupProgress, ServerSetupRequest } from "../../electron/server-setup.mjs";
import { t } from "@/lib/i18n";

export type { ServerSetupProgress, ServerSetupRequest };

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

/** One setup at a time from this page: where it is while it runs, and why it stopped. On success the desktop app opens
 * the new server, so this page goes away. */
export function useServerSetup() {
  const [progress, setProgress] = useState<ServerSetupProgress | null>(null);
  const [failure, setFailure] = useState<SetupFailure | null>(null);

  useEffect(() => bridge()?.onProgress(setProgress), []);

  const start = useCallback(async (request: ServerSetupRequest) => {
    const setup = bridge();
    if (!setup) return;
    setFailure(null);
    setProgress({ step: request.kind === "boat" ? "creating" : "installing" });
    try {
      const result = await setup.start(request);
      if (!result.ok) {
        setProgress(null);
        setFailure({ text: setupErrorText(result.error, request), output: result.error.output || undefined });
      }
    } catch (cause) {
      setProgress(null);
      setFailure({ text: cause instanceof Error ? cause.message : String(cause) });
    }
  }, []);

  return { progress, failure, start };
}
