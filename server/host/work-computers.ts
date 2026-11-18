// The computers the owner lends to this server for bots to work on (a Mac mini, a laptop), next to the Boat and the
// server's own machine. Lending is taken only where nobody but the owner signs in; a bot whose work computer is one of
// them gets that computer's screen, folders and terminal through lent-computer-tools.ts, one job at a time.
import { join } from "node:path";

import { lentBrowserRpc, type LentBrowserRpcDeps } from "../lent-browser-tools.ts";
import { LENT_COMMAND_TOOL, LENT_FILES_TOOL, lentComputerRpc, type LentComputerRpcDeps, type LentNow } from "../lent-computer-tools.ts";
import { LENT_CHROME_OFFER, LENT_NO_PROBES, LENT_SCREEN_BACKGROUND, LENT_SCREEN_BROWSING, lentChromeBrowsing } from "../lent-screen-guidance.ts";
import { createSharedComputerRoutes, WORK_COMPUTER_OWNER } from "../routes/shared-computers.ts";
import { SharedComputerControl } from "../shared-computer-control.ts";
import { deviceWord } from "../lent-computers.ts";
import { LentComputers, SharedComputers, type KnownLentComputer } from "../shared-computers.ts";
import type { TurnOwner, TurnResources } from "../turn-resources.ts";

export interface WorkComputersDeps {
  dataDir: string;
  environmentId: string;
  sessionLive(id: string): boolean;
  /** Nobody but the owner signs in here, and this is no hosted workspace. */
  ownServer(): boolean;
  turnResources: TurnResources;
  holderName(owner: TurnOwner): string | undefined;
}

/** What a turn on a lent computer can use now, and what its bot is told about it. */
export interface LentMount {
  id: string;
  name: string;
  platform: "darwin" | "linux" | "win32" | null;
  online: boolean;
  /** One sentence for the bot when it is not online: offline since, or paused. */
  away: string;
}

export function createWorkComputers(deps: WorkComputersDeps) {
  const lent = new LentComputers(join(deps.dataDir, "lent-computers.json"));
  const computers = new SharedComputers((id) => deps.sessionLive(id), lent);
  const control = new SharedComputerControl(deps.turnResources, deps.holderName);
  const known = (): KnownLentComputer[] => computers.known(WORK_COMPUTER_OWNER);
  const find = (id: string) => known().find((computer) => computer.id === id) ?? null;

  const lendsNow = (id: string): LentNow | null => {
    if (!deps.ownServer()) return null;
    const live = computers.status(WORK_COMPUTER_OWNER).find((computer) => computer.id === id && computer.online);
    const record = find(id);
    if (!live || !record) return null;
    return { name: record.name, computer: live.scopes.screen, terminal: live.scopes.terminal, folders: live.scopes.folders };
  };

  /** Online, and its person's Chrome is connected for the bots' browser tools. */
  const chromeNow = (id: string) => {
    if (!deps.ownServer()) return null;
    const live = computers.status(WORK_COMPUTER_OWNER).find((computer) => computer.id === id && computer.online);
    const record = find(id);
    return live?.scopes.chrome && record ? { name: record.name, device: deviceWord(record.platform) } : null;
  };

  const awayText = (id: string): string => {
    const record = find(id);
    if (!record) return "This bot's work computer is no longer lent to this server. Tell the person in one sentence to choose where it works in its settings.";
    const device = deviceWord(record.platform);
    if (record.paused) return `${record.name} is paused: its owner paused lending from Openpals on that ${device}. Tell the person in one sentence that they can choose Resume there; do not use another computer instead.`;
    if (!record.lent) return `${record.name} no longer lends itself to this server. Tell the person in one sentence to turn on "Let my bots use this computer" in Openpals on that ${device}, or to choose another work computer for this bot.`;
    return `${record.name} is offline: Openpals on that ${device} is closed, or the ${device} is asleep or off. Tell the person in one sentence to open Openpals on it and keep it awake; it reconnects by itself. Do not use another computer instead.`;
  };

  /** One job on behalf of a bot turn; `active` ends it when the turn does. */
  const request = (operation: Parameters<SharedComputers["request"]>[0], active: () => boolean) =>
    computers.request(operation, deps.ownServer() ? WORK_COMPUTER_OWNER : null, () => deps.ownServer() && active());

  const test = async (id: string) => {
    if (!lendsNow(id)) return { ok: false as const, error: awayText(id) };
    try {
      const answer = await request({ computer_id: id, action: "computer_call", tool_name: "get_desktop_state", arguments: { max_image_dimension: 1024 } }, () => true) as
        { content?: Array<{ type?: string; mimeType?: string; data?: string; text?: string }>; isError?: boolean };
      const image = answer?.content?.find((part) => part?.type === "image" && typeof part.data === "string");
      if (answer?.isError || !image) {
        const said = answer?.content?.find((part) => part?.type === "text")?.text;
        return { ok: false as const, error: typeof said === "string" && said.trim() ? said.trim().slice(0, 500) : "The computer answered without a picture of its screen." };
      }
      return { ok: true as const, image: { mimeType: image.mimeType ?? "image/png", data: image.data! } };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const routes = createSharedComputerRoutes({
    accepted: deps.ownServer, computers, sessionLive: deps.sessionLive, environmentId: deps.environmentId, control,
    rename: (id, name) => lent.rename(WORK_COMPUTER_OWNER, id, name),
    forget: (id) => lent.forget(WORK_COMPUTER_OWNER, id),
    test,
  });

  return {
    routes,
    control,
    /** Taken here now: the environment description advertises it to a paired desktop. */
    accepted: deps.ownServer,
    list: known,
    /** The bot's chosen computer as a turn sees it, or null when it was never lent here. */
    mount(id: string): LentMount | null {
      const record = find(id);
      if (!record) return null;
      return { id, name: record.name, platform: record.platform, online: lendsNow(id) !== null, away: awayText(id) };
    },
    /** Whether a bot on this computer browses in its person's Chrome there, instead of the server's own browser. */
    lendsChrome: (id: string) => chromeNow(id) !== null,
    browserRpc(body: Parameters<typeof lentBrowserRpc>[0], turn: Omit<LentBrowserRpcDeps, "chrome" | "away" | "request"> & { active(): boolean }) {
      return lentBrowserRpc(body, {
        ...turn,
        chrome: () => {
          const lends = lendsNow(turn.computerId);
          const record = find(turn.computerId);
          return lends && record ? { name: lends.name, device: deviceWord(record.platform), on: chromeNow(turn.computerId) !== null } : null;
        },
        away: () => awayText(turn.computerId),
        request: (operation) => request(operation, turn.active),
      });
    },
    rpc(body: Parameters<typeof lentComputerRpc>[0], turn: Omit<LentComputerRpcDeps, "lends" | "away" | "request"> & { active(): boolean }) {
      return lentComputerRpc(body, {
        ...turn,
        lends: () => lendsNow(turn.computerId),
        away: () => awayText(turn.computerId),
        request: (operation) => request(operation, turn.active),
      });
    },
    /** The system prompt's lines for a turn that works on this computer. */
    prompt(mounted: LentMount): string {
      if (!mounted.online) return ` This bot works on ${mounted.name}, the person's own computer, but it can't be used now: ${mounted.away} Work that needs no screen can go ahead.`;
      const now = lendsNow(mounted.id);
      const extras = [now?.terminal ? `${LENT_COMMAND_TOOL} runs commands on it` : "", now?.folders.length ? `${LENT_FILES_TOOL} reads and changes the folders it lends` : ""].filter(Boolean).join("; ");
      const screen = find(mounted.id)?.screenReady === false
        ? ` Its screen can't be used yet: macOS hasn't allowed Openpals to see and control it. Before trying, tell the person in one sentence to open System Settings → Privacy & Security on ${mounted.name} and turn on Openpals under Accessibility and under Screen Recording (removing any older Openpals entry first), then quit and reopen Openpals there.`
        : "";
      const browsing = chromeNow(mounted.id) ? lentChromeBrowsing(mounted.name) : `${LENT_SCREEN_BROWSING} ${LENT_CHROME_OFFER}`;
      return ` This bot works on ${mounted.name}, the person's own computer, lent to this server: its screen, its apps and the browsers they are signed in to.${extras ? ` Besides its screen tools, ${extras}.` : ""} ${browsing} ${LENT_SCREEN_BACKGROUND}${screen} ${LENT_NO_PROBES}`;
    },
    close() {
      computers.close();
      control.close();
    },
  };
}

export type WorkComputers = ReturnType<typeof createWorkComputers>;
