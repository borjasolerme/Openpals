/** What the person gave to set up an always-on server: a Boat API key, or `user@address` of their own server. */
export type ServerSetupRequest = { kind: "boat"; key: string } | { kind: "ssh"; address: string };

/** Where a setup is: making the Boat machine, running the installer (`detail`: its current step, in English), then
 * connecting this app to the new server. */
export interface ServerSetupProgress {
  step: "creating" | "installing" | "connecting";
  detail?: string;
}

/** Why a setup stopped. `message` is Boat's own (a plan, a limit); `output` is the installer's last lines, scrubbed of
 * any pairing code. */
export interface ServerSetupError {
  code:
    | "boat-key" | "boat-refused" | "network" | "timeout" | "install-failed" | "unreachable"
    | "ssh-address" | "ssh-key" | "ssh-host-key" | "ssh-unreachable" | "ssh-missing" | "unsupported";
  message?: string;
  output?: string;
}

export type ServerSetupResult = { ok: true } | { ok: false; error: ServerSetupError };

export interface ServerSetupBridge {
  start(request: ServerSetupRequest): Promise<ServerSetupResult>;
  onProgress(callback: (progress: ServerSetupProgress) => void): () => void;
}

export declare const INSTALLER_URL: string;
export declare function pairingLinkIn(output: string): string | null;
export declare function scrubbed(text: string): string;
export declare function lastLines(output: string): string;
export declare function appendOutput(log: string, chunk: string): string;
export declare function createStepReader(onStep: (step: string) => void): (chunk: string) => void;
