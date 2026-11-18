// The Docker CLI is the only local piece of the VPS backend — every command is `docker -H ssh://<alias>` and
// the daemon stays on the server — so a missing client is the one VPS problem a person fixes in a terminal.
// These are the sentences the bot panel and Settings show while that is the case.
const DOCKER_CLI_INSTALL: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  darwin: "brew install docker",
  win32: "winget install -e --id Docker.DockerCLI",
  linux: "sudo apt install docker-ce-cli",
};

export function dockerCliInstallCommand(platform: NodeJS.Platform = process.platform): string | null {
  return DOCKER_CLI_INSTALL[platform] ?? null;
}

/** spawn reports ENOENT for an absent `docker`; every other transport failure keeps its own message. */
export function dockerCliMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b/.test(message) && /docker/i.test(message);
}

export function dockerCliMissingProblem(): string {
  const command = dockerCliInstallCommand();
  return command
    ? `The Docker CLI is not on PATH. Install the client only: ${command}`
    : "The Docker CLI is not on PATH. Install the Docker client, then retry.";
}

/** Lifecycle errors surface the spawn failure raw, so it carries the hint too. */
export function dockerCliStartMessage(error: Error): string {
  return `Docker-over-SSH could not start: ${error.message}${dockerCliMissing(error) ? `. ${dockerCliMissingProblem()}` : ""}`;
}

export function vpsStartsForTurn(input: { wants: "cloud" | "local" | "off" | undefined; autoStartVps?: boolean; automationSource?: string }): boolean {
  if (input.wants === "cloud") return true;
  if (input.wants !== undefined) return false;
  return input.autoStartVps === true || Boolean(input.automationSource);
}

export function vpsUnavailableHint(input: { automationSource?: string; autoStartVps?: boolean; reachable?: boolean }): string {
  if (input.automationSource) return "This scheduled run tried to start the VPS computer and could not reach it. Check the VPS connection in Settings → API keys.";
  if (input.autoStartVps || input.reachable === false) return "Check the VPS connection in Settings → API keys.";
  return input.reachable ? "Open Computer and enable Start VPS automatically, or choose Cloud computer to start it manually." : "";
}

/** A VPS desktop OpenMausBot made whose image this release no longer runs. Replacing it deletes its files, so a person does it. */
export function vpsDesktopOutdated(status: {
  configured?: boolean; daemonUp?: boolean; container?: string; managed?: boolean; imageMatches?: boolean;
} | null | undefined): boolean {
  return Boolean(status?.configured && status.daemonUp && status.container !== "missing" && status.managed && !status.imageMatches);
}

export const VPS_OUTDATED_HINT =
  "Its VPS desktop runs an older version: the person can replace it from this bot's Computer panel, which deletes the files on it.";

export const HOST_WHILE_UPDATING = "This bot's own desktop needs updating, so it does not use this computer instead.";

/** select_computer offers this computer to no bot whose own desktop awaits its update, or "auto" would land the work there. */
export function withoutHostWhileUpdating<T extends { surface: string; available: boolean }>(options: T[], barred: boolean): T[] {
  return barred ? options.map((option) => option.surface === "local"
    ? { ...option, available: false, ready: false, canStart: false, canCreate: false, reason: HOST_WHILE_UPDATING } : option) : options;
}
